// libnrsc5 v3.2.0 ABI. This process receives CU8 IQ on stdin and emits
// framed stereo PCM on stdout; decoded broadcast metadata travels over IPC.
import koffi from 'koffi';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../native/hd-radio/', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const libraryPath = path.join(root, manifest.library);
let api, handle, callback, stopped = false, closed = false, selectedProgram = Number(process.env.SDREXTREME_HD_PROGRAM) || 0;
const send = value => { if (process.connected) process.send(value); };
const text = value => String(value || '').replace(/[\x00-\x08\x0b-\x1f]/g, '').slice(0, 1000);
const validProgram = program => Number.isInteger(program) && program >= 0 && program <= 7;

// Decode only the selected event payload. In the pinned Windows x64 header,
// the uint32 tag is followed by an 8-byte-aligned C union at offset 8.
const Audio = koffi.struct('HdAudio', { program: 'uint32_t', data: 'void *', count: 'size_t' });
const Hdc = koffi.struct('HdHdc', { program: 'uint32_t', data: 'void *', count: 'size_t', flags: 'uint32_t' });
const metrics = { hdcPackets: 0, badHdcPackets: 0, pcmBlocks: 0, silentPcmBlocks: 0, pcmFrames: 0, maxPcmGapMs: 0 };
let lastMetrics = 0, lastPcm = 0;
function reportMetrics() { const now = Date.now(); if (now - lastMetrics > 500) { lastMetrics = now; send({ type: 'metrics', metrics: { ...metrics } }); } }
const Xhdr = koffi.struct('HdXhdr', { mime: 'uint32_t', param: 'int', lot: 'int' });
const Ufid = koffi.struct('HdUfid', { owner: 'const char *', id: 'const char *' });
const Id3 = koffi.struct('HdId3', { program: 'uint32_t', title: 'const char *', artist: 'const char *', album: 'const char *', genre: 'const char *', ufid: Ufid, xhdr: Xhdr, comments: 'void *' });
const Service = koffi.struct('HdService', { next: 'void *', type: 'uint8_t', number: 'uint16_t', name: 'const char *', components: 'void *', audio_component: 'void *' });
const DataComponent = koffi.struct('HdDataComponent', { port: 'uint16_t', service_data_type: 'uint16_t', type: 'uint8_t', mime: 'uint32_t' });
const AudioComponent = koffi.struct('HdAudioComponent', { port: 'uint8_t', type: 'uint8_t', mime: 'uint32_t' });
const Component = koffi.struct('HdComponent', { next: 'void *', type: 'uint8_t', id: 'uint8_t', payload: koffi.union('HdComponentPayload', { data: DataComponent, audio: AudioComponent }) });
const Lot = koffi.struct('HdLot', { port: 'uint16_t', lot: 'uint32_t', size: 'uint32_t', mime: 'uint32_t', name: 'const char *', data: 'void *', expiry_utc: 'void *', service: 'void *', component: 'void *' });
const Asd = koffi.struct('HdAsd', { program: 'uint32_t', access: 'uint32_t', type: 'uint32_t', sound_exp: 'uint32_t' });
const AudioService = koffi.struct('HdAudioService', { program: 'uint32_t', access: 'uint32_t', type: 'uint32_t', codec_mode: 'uint32_t', blend_control: 'uint32_t', digital_audio_gain: 'int', common_delay: 'uint32_t', latency: 'uint32_t' });
const stationId = koffi.struct('HdStationId', { country_code: 'const char *', fcc_facility_id: 'int' });
const Sync = koffi.struct('HdSync', { freq_offset: 'float', psmi: 'int', pli: 'int', hppi: 'int', aabi: 'int', rdbi: 'int' });
const decode = (event, type) => koffi.decode(event, 8, type);

function programType(type) {
  const output = [null]; api.programType(type, output); return text(output[0]);
}
function serviceInfo(pointer) {
  if (!pointer) return null;
  const item = koffi.decode(pointer, Service);
  let program = null;
  if (item.type === 0 && item.audio_component) {
    const component = koffi.decode(item.audio_component, Component);
    if (component.type === 0) program = component.payload.audio.port;
  }
  return { number: item.number, name: text(item.name), type: item.type, program: validProgram(program) ? program : null };
}

function receive(event) {
  if (stopped) return;
  try {
    const tag = koffi.decode(event, 'uint32_t');
    if (tag === 6) {
      const hdc = decode(event, Hdc);
      if (hdc.program === selectedProgram) { metrics.hdcPackets++; metrics.badHdcPackets += hdc.flags & 1 ? 1 : 0; reportMetrics(); }
    } else if (tag === 7) {
      const audio = decode(event, Audio), count = Number(audio.count);
      if (audio.program !== selectedProgram || !audio.data || count < 2 || count > 32768 || count % 2) return;
      const pcm = Buffer.from(koffi.decode(audio.data, 'uint8_t', count * 2));
      const now = Date.now(); metrics.pcmBlocks++; metrics.pcmFrames += count / 2; metrics.silentPcmBlocks += pcm.every(value => value === 0) ? 1 : 0;
      if (lastPcm) metrics.maxPcmGapMs = Math.max(metrics.maxPcmGapMs, now - lastPcm); lastPcm = now; reportMetrics();
      const header = Buffer.alloc(12); header.write('HDR5'); header.writeUInt32LE(audio.program, 4); header.writeUInt32LE(pcm.length, 8);
      if (process.stdout.writableLength > 2_000_000) throw new Error('HD audio output cannot keep up.');
      process.stdout.write(Buffer.concat([header, pcm]));
    } else if (tag === 8) {
      const id3 = decode(event, Id3);
      if (validProgram(id3.program)) send({ type: 'id3', program: id3.program, title: text(id3.title), artist: text(id3.artist), album: text(id3.album), genre: text(id3.genre), xhdr: id3.xhdr });
    } else if (tag === 2) send({ type: 'sync', synced: true, ...decode(event, Sync) });
    else if (tag === 3) send({ type: 'sync', synced: false });
    else if (tag === 4) send({ type: 'mer', lower: koffi.decode(event, 8, 'float'), upper: koffi.decode(event, 12, 'float') });
    else if (tag === 5) send({ type: 'ber', ber: koffi.decode(event, 8, 'float') });
    else if (tag === 9) {
      let pointer = koffi.decode(event, 8, 'void *'); const services = [], seen = new Set();
      while (pointer && services.length < 64 && !seen.has(String(pointer))) {
        seen.add(String(pointer)); const item = koffi.decode(pointer, Service); const service = serviceInfo(pointer);
        const components = []; let cp = item.components; const componentSeen = new Set();
        while (cp && components.length < 32 && !componentSeen.has(String(cp))) {
          componentSeen.add(String(cp)); const c = koffi.decode(cp, Component);
          components.push(c.type === 0 ? { kind: 'audio', ...c.payload.audio } : { kind: 'data', ...c.payload.data }); cp = c.next;
        }
        services.push({ ...service, components }); pointer = item.next;
      }
      send({ type: 'services', services });
    } else if (tag === 10) {
      const lot = decode(event, Lot);
      if (!lot.data || lot.size < 8 || lot.size > 2 * 1024 * 1024 || ![0x1e653e9c, 0x4f328ca0].includes(lot.mime)) return;
      send({ type: 'lot', lot: lot.lot, port: lot.port, mime: lot.mime, service: serviceInfo(lot.service), data: Buffer.from(koffi.decode(lot.data, 'uint8_t', lot.size)).toString('base64') });
    } else if (tag === 14 || tag === 20) {
      const data = decode(event, tag === 14 ? AudioService : Asd);
      const { type: genreCode, ...fields } = data;
      if (validProgram(data.program)) send({ ...fields, type: 'service', genreCode, genre: programType(genreCode) });
    } else if (tag === 15) send({ type: 'station', country: text(decode(event, stationId).country_code), facilityId: decode(event, stationId).fcc_facility_id });
    else if ([16, 17, 18].includes(tag)) send({ type: 'station', [({ 16: 'name', 17: 'slogan', 18: 'message' })[tag]]: text(koffi.decode(event, 8, 'const char *')) });
    else if (tag === 0) throw new Error('The HD decoder lost its receiver input.');
  } catch (error) { fatal(error); }
}
function close() {
  if (closed) return; closed = true; stopped = true;
  if (handle) { api.close(handle); handle = null; }
  if (callback) { koffi.unregister(callback); callback = null; }
}
function fatal(error) {
  if (stopped) return; stopped = true;
  send({ type: 'fatal', error: error.message }); process.stdin.destroy();
  // A callback may be running inside nrsc5_pipe_samples_cu8. Free its native
  // session only after that call has returned to the event loop.
  setImmediate(() => { close(); process.exit(1); });
}

try {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('HD Radio requires Windows x64.');
  if (createHash('sha256').update(fs.readFileSync(libraryPath)).digest('hex') !== manifest.librarySha256) throw new Error('The bundled HD Radio library does not match its pinned build.');
  const lib = koffi.load(libraryPath);
  const cb = koffi.proto('void HdEventCallback(void *event, void *opaque)');
  api = {
    open: lib.func('int nrsc5_open_pipe(_Out_ void **handle)'),
    mode: lib.func('int nrsc5_set_mode(void *handle, int mode)'),
    frequency: lib.func('int nrsc5_set_frequency(void *handle, float frequency)'),
    callback: lib.func('nrsc5_set_callback', 'void', ['void *', koffi.pointer(cb), 'void *']),
    pipe: lib.func('int nrsc5_pipe_samples_cu8(void *handle, const uint8_t *samples, unsigned int length)'),
    close: lib.func('void nrsc5_close(void *handle)'),
    version: lib.func('void nrsc5_get_version(_Out_ const char **version)'),
    programType: lib.func('void nrsc5_program_type_name(unsigned int type, _Out_ const char **name)')
  };
  const result = [null]; if (api.open(result) !== 0) throw new Error('Cannot initialize the HD Radio decoder.'); handle = result[0];
  if (api.mode(handle, process.env.SDREXTREME_HD_BAND === 'AM' ? 1 : 0) !== 0) throw new Error('Cannot set the HD Radio broadcast band.');
  if (api.frequency(handle, Number(process.env.SDREXTREME_HD_FREQUENCY)) !== 0) throw new Error('Cannot initialize the HD Radio frequency.');
  callback = koffi.register(receive, koffi.pointer(cb)); api.callback(handle, callback, null);
  process.on('message', message => { if (message.op === 'program' && validProgram(message.program)) selectedProgram = message.program; });
  let remainder = null;
  process.stdin.on('data', chunk => {
    if (stopped) return;
    try {
      if (remainder) { chunk = Buffer.concat([remainder, chunk]); remainder = null; }
      if (chunk.length % 2) { remainder = Buffer.from(chunk.subarray(-1)); chunk = chunk.subarray(0, -1); }
      if (chunk.length && api.pipe(handle, chunk, chunk.length) !== 0) throw new Error('HD Radio sample decoding failed.');
    } catch (error) { fatal(error); }
  });
  process.stdin.on('end', () => { close(); process.exit(0); });
  process.on('disconnect', () => { close(); process.exit(0); });
  process.stdout.on('error', () => { close(); process.exit(0); });
  const version = [null]; api.version(version); send({ type: 'ready', version: text(version[0]) });
} catch (error) { fatal(error); }
