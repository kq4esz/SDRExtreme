// DSD's pipe carries 8 kHz signed little-endian PCM. Keep frame boundaries
// across OS pipe reads, mix the TDMA slots, and interpolate for the 48 kHz UI.
export class DigitalAudio {
  constructor(channels = 1) {
    if (![1, 2].includes(channels)) throw new Error('Digital PCM must have one or two channels.');
    this.channels = channels;
    this.remainder = Buffer.alloc(0);
    this.previous = null;
    this.frames = 0;
  }

  push(chunk) {
    const bytes = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk;
    const stride = this.channels * 2;
    const frames = Math.floor(bytes.length / stride);
    this.remainder = Buffer.from(bytes.subarray(frames * stride));
    const output = new Float32Array(frames * 6);
    let power = 0;
    for (let i = 0; i < frames; i++) {
      const offset = i * stride;
      let sample = bytes.readInt16LE(offset) / 32768;
      if (this.channels === 2) sample = (sample + bytes.readInt16LE(offset + 2) / 32768) / 2;
      const previous = this.previous ?? sample;
      for (let j = 1; j <= 6; j++) {
        const value = previous + (sample - previous) * j / 6;
        output[i * 6 + j - 1] = value;
        power += value * value;
      }
      this.previous = sample;
    }
    this.frames += frames;
    return { samples: output, level: output.length ? Math.sqrt(power / output.length) : 0 };
  }
}
