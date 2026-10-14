// Mono broadcast FM from the same centered CU8 IQ used by nrsc5.
// Filter before each decimation stage so digital sidebands, the stereo
// pilot and out-of-band energy do not alias into the fallback audio.
function lowpass(length, cutoff, rate) {
  const taps = new Float64Array(length), middle = (length - 1) / 2;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const x = i - middle;
    const sinc = x === 0 ? 2 * cutoff / rate : Math.sin(2 * Math.PI * cutoff * x / rate) / (Math.PI * x);
    taps[i] = sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (length - 1))); sum += taps[i];
  }
  for (let i = 0; i < length; i++) taps[i] /= sum;
  return taps;
}

class Decimator {
  constructor(taps, factor, complex = false) {
    this.taps = taps; this.factor = factor; this.position = 0; this.phase = 0;
    this.i = new Float64Array(taps.length * 2); this.q = complex ? new Float64Array(taps.length * 2) : null;
  }
  push(i, q = 0) {
    const n = this.taps.length, p = this.position;
    this.i[p] = this.i[p + n] = i;
    if (this.q) this.q[p] = this.q[p + n] = q;
    this.position = (p + 1) % n;
    if (++this.phase !== this.factor) return false;
    this.phase = 0;
    let real = 0, imag = 0;
    const start = this.position, half = (n - 1) >> 1;
    for (let k = 0; k < half; k++) {
      real += this.taps[k] * (this.i[start + k] + this.i[start + n - 1 - k]);
      if (this.q) imag += this.taps[k] * (this.q[start + k] + this.q[start + n - 1 - k]);
    }
    this.real = real + this.taps[half] * this.i[start + half];
    this.imag = imag + (this.q ? this.taps[half] * this.q[start + half] : 0);
    return true;
  }
}

export class BroadcastFm {
  constructor(rate = 1488375) {
    this.rate = rate; this.ifRate = rate / 5; this.audioRate = rate / 25;
    this.rf = new Decimator(lowpass(161, 105000, rate), 5, true);
    this.af = new Decimator(lowpass(97, 15000, this.ifRate), 5);
    this.previousI = 0; this.previousQ = 0; this.havePrevious = false;
    this.lastInput = 0; this.dc = 0; this.deemphasis = 0; this.lastAudio = 0; this.resample = 0;
    this.dcPole = Math.exp(-2 * Math.PI * 30 / this.audioRate);
    this.deemphasisAlpha = 1 - Math.exp(-1 / (75e-6 * this.audioRate));
  }
  push(bytes) {
    const output = new Float32Array(Math.ceil(bytes.length / 2 * 48000 / this.rate) + 4);
    let length = 0;
    for (let p = 0; p + 1 < bytes.length; p += 2) {
      if (!this.rf.push((bytes[p] - 127.5) / 127.5, (bytes[p + 1] - 127.5) / 127.5)) continue;
      const i = this.rf.real, q = this.rf.imag;
      const sample = this.havePrevious ? Math.atan2(this.previousI * q - this.previousQ * i, this.previousI * i + this.previousQ * q) * this.ifRate / (2 * Math.PI * 75000) : 0;
      this.previousI = i; this.previousQ = q; this.havePrevious = true;
      if (!this.af.push(sample)) continue;
      const highpass = this.af.real - this.lastInput + this.dcPole * this.dc;
      this.lastInput = this.af.real; this.dc = highpass;
      this.deemphasis += this.deemphasisAlpha * (highpass - this.deemphasis);
      const audio = Math.max(-0.98, Math.min(0.98, this.deemphasis * 0.9));
      this.resample += 48000;
      while (this.resample >= this.audioRate) {
        const blend = 1 - (this.resample - this.audioRate) / 48000;
        output[length++] = this.lastAudio + (audio - this.lastAudio) * blend;
        this.resample -= this.audioRate;
      }
      this.lastAudio = audio;
    }
    return output.subarray(0, length);
  }
}
