import { performance } from 'node:perf_hooks';

export class HdReceiverMetrics {
  constructor() { this.value = {}; this.resetWindow(); }
  resetWindow() { this.since = performance.now(); this.lastAt = this.since; this.bytes = 0; this.count = 0; this.clip = 0; this.power = 0; this.min = 255; this.max = 0; this.maxGap = 0; }
  push(bytes) {
    const now = performance.now(); this.maxGap = Math.max(this.maxGap, now - this.lastAt); this.lastAt = now; this.bytes += bytes.length;
    for (let i = 0; i + 1 < bytes.length; i += 32) {
      for (let c = 0; c < 2; c++) { const value = bytes[i + c]; this.min = Math.min(this.min, value); this.max = Math.max(this.max, value); this.clip += value <= 1 || value >= 254 ? 1 : 0; this.power += ((value - 127.5) / 127.5) ** 2; this.count++; }
    }
    if (now - this.since < 1000) return;
    this.value = { observedSampleRate: Math.round(this.bytes / 2 * 1000 / (now - this.since)), clippingPercent: this.clip / this.count * 100,
      iqRmsDbfs: 10 * Math.log10(Math.max(1e-12, this.power / this.count)), amplitudeDbfs: 20 * Math.log10((this.max - this.min + 1) / 256), maxUsbGapMs: this.maxGap };
    this.since = now; this.bytes = 0; this.count = 0; this.clip = 0; this.power = 0; this.min = 255; this.max = 0; this.maxGap = 0;
    return this.value;
  }
}
