import { DIGITAL_MODES, digitalScanProfile } from './channel-protocols.mjs';

export function scanPlan(channels, body = {}) {
  const explicit = body.channelIds !== undefined;
  if (explicit && (!Array.isArray(body.channelIds) || !body.channelIds.length)) throw new Error('Select at least one memory channel to scan.');
  const ids = explicit ? [...new Set(body.channelIds)] : channels.filter(channel => channel.enabled !== false && channel.kind !== 'trunked' && channel.mode !== 'HD' && !DIGITAL_MODES.has(channel.mode)).map(channel => channel.id);
  if (!ids.length) throw new Error('Add or select at least one conventional memory channel.');
  if (ids.length > 256) throw new Error('Scan up to 256 selected memories at a time.');
  const selected = ids.map(id => {
    const channel = channels.find(item => item.id === id);
    if (!channel) throw new Error('A selected memory no longer exists. Refresh the library and select again.');
    if (channel.kind === 'trunked') throw new Error('Rapid scan uses conventional frequencies. Open a trunked system in Decoders to follow its control channel and talkgroups.');
    if (channel.enabled === false) throw new Error(`Enable “${channel.name}” before scanning it.`);
    if (channel.mode === 'HD') throw new Error('HD Radio needs time to acquire its digital signal. Tune HD memories individually; exclude them from rapid scans.');
    return channel;
  });
  const digital = selected.filter(channel => DIGITAL_MODES.has(channel.mode));
  if (digital.length && digital.length !== selected.length) throw new Error('Select analog memories or digital memories in one scan. The native receiver and digital decoder require separate scan groups.');
  const rapid = body.rapid === true;
  const requested = Number(body.dwellMs ?? (rapid ? 150 : 1500));
  if (!Number.isFinite(requested)) throw new Error('Choose a valid scan dwell time.');
  return { channels: selected, channelIds: ids, engine: digital.length ? 'digital' : 'native', profile: digital.length ? digitalScanProfile(selected) : null,
    rapid, dwellMs: Math.round(Math.max(rapid ? 80 : 500, Math.min(15000, requested))),
    holdOnSignal: body.holdOnSignal !== false, holdMs: Math.max(250, Math.min(10000, Number(body.holdMs) || 1500)), thresholdDb: Math.max(3, Math.min(30, Number(body.thresholdDb) || 8)) };
}

export function spectrumSnr(bins, sampleRate, mode) {
  const bandwidth = { AM: 10000, NFM: 12500, WFM: 160000, USB: 5000, LSB: 5000, CW: 2500 }[mode] || 12500;
  const center = bins.length / 2, width = Math.max(2, Math.ceil(bandwidth / sampleRate * bins.length / 2));
  const signal = [], noise = [];
  for (let i = 0; i < bins.length; i++) {
    const distance = Math.abs(i - center);
    if (distance >= 1 && distance <= width) signal.push(bins[i]);
    if (distance >= width * 2 && distance <= Math.max(width * 6, 20)) noise.push(bins[i]);
  }
  if (!signal.length || !noise.length) return 0;
  noise.sort((a, b) => a - b); signal.sort((a, b) => b - a);
  return signal.slice(0, Math.min(3, signal.length)).reduce((a, b) => a + b, 0) / Math.min(3, signal.length) - noise[Math.floor(noise.length / 2)];
}

/** One serial tuning loop; stopping invalidates both queued timers and in-flight results. */
export class MemoryScanner {
  constructor(plan, { tune, event = () => {}, error = () => {}, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
    Object.assign(this, { plan, tune, event, error, now, schedule, cancel });
    this.active = false; this.index = -1; this.hops = 0; this.holding = false; this.startedAt = 0; this.hits = 0; this.epoch = 0;
  }
  snapshot() { return { active: this.active, engine: 'native', rapid: this.plan.rapid, dwellMs: this.plan.dwellMs, channelIds: this.plan.channelIds, channelCount: this.plan.channels.length, holding: this.holding, channel: this.current || null, hops: this.hops }; }
  async start() { this.active = true; await this.advance(); if (this.failure) throw this.failure; return this.snapshot(); }
  stop() { this.active = false; this.epoch++; if (this.timer !== undefined) this.cancel(this.timer); this.timer = undefined; }
  async advance() {
    if (!this.active || this.busy) return;
    this.busy = true; const epoch = this.epoch;
    if (this.timer !== undefined) this.cancel(this.timer);
    this.holding = false; this.hits = 0;
    const channel = this.plan.channels[(this.index + 1) % this.plan.channels.length];
    try {
      await this.tune(channel);
      if (!this.active || epoch !== this.epoch) return;
      this.index = (this.index + 1) % this.plan.channels.length;
      this.current = channel; this.startedAt = this.now(); this.hops++;
      this.event('scan', this.snapshot());
      this.timer = this.schedule(() => this.advance(), this.plan.dwellMs);
    } catch (error) { this.failure = error; this.stop(); this.error(error); }
    finally { this.busy = false; }
  }
  observe(snr) {
    if (!this.active || this.busy || !this.current || !this.plan.holdOnSignal || this.now() - this.startedAt < 40) return;
    const strong = snr >= this.plan.thresholdDb;
    this.hits = strong ? this.hits + 1 : 0;
    if (strong && this.holding) this.lastSignalAt = this.now();
    if (!this.holding && this.hits >= (this.plan.dwellMs < 140 ? 1 : 2)) {
      this.holding = true; this.lastSignalAt = this.now();
      if (this.timer !== undefined) this.cancel(this.timer);
      this.event('scan-hold', this.snapshot());
      this.checkHold();
    }
  }
  checkHold() {
    if (!this.active || !this.holding) return;
    const remaining = this.plan.holdMs - (this.now() - this.lastSignalAt);
    this.timer = this.schedule(() => remaining <= 0 ? this.advance() : this.checkHold(), Math.max(25, Math.min(100, remaining)));
  }
  skip() { if (!this.active) return; if (this.timer !== undefined) this.cancel(this.timer); return this.advance(); }
}
