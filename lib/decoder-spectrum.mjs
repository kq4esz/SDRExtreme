import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { sparseIqFile } from './native-process.mjs';
import { RF_WINDOW_BYTES, spectrumFromCu8 } from './rf-spectrum.mjs';

const KEEP_BYTES = 4 * 1024 * 1024;
const ALLOCATION_UNIT = 65536;

export class DecoderSpectrum extends EventEmitter {
  constructor(folder, frequency) {
    super();
    this.filename = path.join(folder, 'live-rf.iq');
    this.metadataFile = this.filename + '.json';
    this.frequency = frequency;
    this.epoch = 0;
    this.session = Date.now();
    this.stopped = false;
    this.reclaimed = 0;
    this.previousSize = 0;
    this.previousEnd = 0;
    this.changedAt = 0;
    this.metadata = null;
  }

  async prepare() {
    this.file = await fs.open(this.filename, 'wx+');
    try { this.sparse = sparseIqFile(this.filename, this.file.fd); }
    catch (error) { await this.close(); throw error; }
  }

  get args() { return ['--iq-capture', this.filename, '--iq-capture-format', 'cu8', '--iq-capture-max-mb', '0']; }

  tune(frequency) {
    if (!Number.isFinite(frequency) || frequency < 10000 || frequency === this.frequency) return;
    this.frequency = frequency; this.epoch++; this.changedAt = Date.now(); this.previousEnd = 0;
  }

  start() {
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      if (this.work || this.stopped) return;
      this.work = this.poll().catch(error => {
        if (!this.stopped) { clearInterval(this.timer); this.emit('failure', error); }
      }).finally(() => { this.work = null; });
    }, 100);
    this.timer.unref?.();
  }

  async poll() {
    const { size } = await this.file.stat();
    if (size < this.previousSize) { this.metadata = null; this.reclaimed = 0; this.previousEnd = 0; this.epoch++; this.changedAt = Date.now(); }
    this.previousSize = size;
    const reclaimTo = Math.floor((size - KEEP_BYTES) / ALLOCATION_UNIT) * ALLOCATION_UNIT;
    if (reclaimTo > this.reclaimed) { await this.sparse.release(this.reclaimed, reclaimTo); this.reclaimed = reclaimTo; }
    if (!this.metadata) {
      try {
        const value = JSON.parse(await fs.readFile(this.metadataFile, 'utf8'));
        if (value.sample_format !== 'cu8' || !Number.isFinite(value.sample_rate_hz) || value.sample_rate_hz <= 0) throw new Error('The decoder RF feed is not unsigned 8-bit IQ.');
        this.metadata = value;
      } catch (error) {
        if (Date.now() - this.startedAt > 8000 || (error.code !== 'ENOENT' && !(error instanceof SyntaxError))) throw error;
        return;
      }
    }
    const end = Math.floor(size / 2) * 2;
    if (end < RF_WINDOW_BYTES || end === this.previousEnd || Date.now() - this.changedAt < 40) return;
    const epoch = this.epoch;
    const bytes = Buffer.alloc(RF_WINDOW_BYTES);
    const { bytesRead } = await this.file.read(bytes, 0, bytes.length, end - bytes.length);
    if (this.stopped || epoch !== this.epoch || bytesRead !== bytes.length) return;
    this.previousEnd = end;
    const offset = Number(this.metadata.capture_center_frequency_hz) - Number(this.metadata.center_frequency_hz);
    const center = this.frequency + (Number.isFinite(offset) ? offset : 0);
    this.emit('spectrum', { type: 'spectrum', source: 'digital', bins: spectrumFromCu8(bytes),
      center, span: this.metadata.sample_rate_hz, tunedFrequency: this.frequency,
      timestamp: Date.now(), epoch: `${this.session}:${this.epoch}`, units: 'dBFS' });
  }

  close() { return this.closing ||= this.finishClose(); }

  async finishClose() {
    this.stopped = true; clearInterval(this.timer);
    await this.work;
    this.sparse?.close(); this.sparse = null;
    await this.file?.close().catch(() => {}); this.file = null;
    // These exact, app-created paths are removed only after the decoder closes.
    for (const filename of [this.filename, this.metadataFile]) {
      try { await fs.unlink(filename); } catch (error) { if (error.code !== 'ENOENT') this.emit('cleanup-warning', error); }
    }
  }
}
