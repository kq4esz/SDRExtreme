// A small playback reserve absorbs 20 ms network packets and the browser's
// larger audio callbacks. Empty callbacks rebuffer once instead of producing
// a small gap on every subsequent callback.
export class PlaybackBuffer {
  constructor({ capacity = 96000, prefill = 12000 } = {}) {
    this.capacity = capacity; this.prefill = prefill; this.samples = new Float32Array(capacity * 2);
    this.underruns = 0; this.trimmed = 0; this.received = 0; this.rendered = 0; this.clear();
  }
  clear() { this.read = 0; this.write = 0; this.frames = 0; this.fraction = 0; this.playing = false; }
  push(samples, channels = 1) {
    for (let i = 0; i < samples.length; i += channels) {
      if (this.frames === this.capacity) { this.read = (this.read + 1) % this.capacity; this.frames--; this.trimmed++; }
      this.samples[this.write * 2] = samples[i]; this.samples[this.write * 2 + 1] = channels === 2 ? samples[i + 1] : samples[i];
      this.write = (this.write + 1) % this.capacity; this.frames++; this.received++;
    }
    // A suspended output should resume near live audio.
    if (this.frames > 48000) { const drop = this.frames - this.prefill; this.read = (this.read + drop) % this.capacity; this.frames -= drop; this.trimmed += drop; }
  }
  render(left, right, outputRate = 48000) {
    const ratio = 48000 / outputRate, needed = Math.ceil(left.length * ratio + this.fraction);
    if (!this.playing && this.frames >= Math.max(this.prefill, needed)) this.playing = true;
    if (this.playing && this.frames < needed) { this.playing = false; this.underruns++; }
    if (!this.playing) { left.fill(0); right.fill(0); return; }
    for (let i = 0; i < left.length; i++) {
      const next = this.frames > 1 ? (this.read + 1) % this.capacity : this.read;
      left[i] = this.samples[this.read * 2] * (1 - this.fraction) + this.samples[next * 2] * this.fraction;
      right[i] = this.samples[this.read * 2 + 1] * (1 - this.fraction) + this.samples[next * 2 + 1] * this.fraction;
      this.fraction += ratio;
      while (this.fraction >= 1 && this.frames) { this.read = (this.read + 1) % this.capacity; this.frames--; this.fraction--; }
    }
    this.rendered += left.length;
  }
  snapshot() { return { playing: this.playing, bufferedMs: this.frames / 48, underruns: this.underruns, receivedFrames: this.received, renderedFrames: this.rendered, trimmedFrames: this.trimmed }; }
}
