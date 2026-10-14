import fs from 'node:fs';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const seconds = Number(process.argv[2] || 60), label = process.argv[3] || 'hd-live';
const root = new URL('../local-data/hd-diagnostics/', import.meta.url); fs.mkdirSync(root, { recursive: true });
const rows = [], started = Date.now();
let audioFrames = 0, packets = 0, zeroFrames = 0, maxGap = 0, lastAudio = 0, sourceChanges = [], previousSource;
let socket, pending = Buffer.alloc(0);
function message(data) {
  if (typeof data === 'string') {
    const row = JSON.parse(data);
    const hd = row.type === 'hd-state' ? row.hd : row.type === 'status' ? row.status?.hd : null;
    if (hd && hd.audioSource !== previousSource) { previousSource = hd.audioSource; sourceChanges.push({ second: (Date.now() - started) / 1000, source: hd.audioSource, reason: hd.audioReason }); }
    return;
  }
  const view = new DataView(data), stereo = data.byteLength >= 8 && view.getUint32(0, false) === 0x48444131;
  const samples = new Float32Array(data, stereo ? 8 : 0), frames = samples.length / (stereo ? 2 : 1);
  audioFrames += frames; packets++; if (!samples.some(value => Math.abs(value) > 0.000001)) zeroFrames += frames;
  if (lastAudio) maxGap = Math.max(maxGap, Date.now() - lastAudio); lastAudio = Date.now();
}
const request = http.request('http://127.0.0.1:17890/stream', { headers: { connection: 'Upgrade', upgrade: 'websocket', origin: 'http://127.0.0.1:17890', 'sec-websocket-key': randomBytes(16).toString('base64'), 'sec-websocket-version': '13' } });
await new Promise((resolve, reject) => {
  request.once('error', reject); request.once('response', response => reject(new Error(`WebSocket upgrade rejected (${response.statusCode}).`)));
  request.once('upgrade', (_response, stream, head) => {
    socket = stream;
    const read = bytes => {
      pending = Buffer.concat([pending, bytes]);
      while (pending.length >= 2) {
        const opcode = pending[0] & 15; let size = pending[1] & 127, offset = 2;
        if (size === 126) { if (pending.length < 4) return; size = pending.readUInt16BE(2); offset = 4; }
        if (size === 127) { if (pending.length < 10) return; size = Number(pending.readBigUInt64BE(2)); offset = 10; }
        if (pending.length < offset + size) return;
        const payload = pending.subarray(offset, offset + size); pending = pending.subarray(offset + size);
        if (opcode === 1) message(payload.toString());
        else if (opcode === 2) message(Uint8Array.from(payload).buffer);
      }
    };
    stream.on('data', read); stream.on('error', error => console.error(error.message)); if (head.length) read(head); resolve();
  });
  request.end();
});
try {
  for (let second = 0; second < seconds; second++) {
    const { status } = await (await fetch('http://127.0.0.1:17890/api/state')).json(), hd = status.hd;
    const row = { second: (Date.now() - started) / 1000, active: status.hdActive, gain: status.gain, synced: hd?.synced, source: hd?.audioSource,
      mer: hd?.mer, ber: hd?.ber, offset: hd?.frequencyOffset, diagnostics: hd?.diagnostics, audioAge: hd?.lastAudioAt ? Date.now() - hd.lastAudioAt : null,
      decoderError: hd?.decoderError, fallbackError: hd?.fallbackError, title: hd?.selected?.title };
    rows.push(row); if (second % 5 === 0) console.log(JSON.stringify(row)); await delay(1000);
  }
} finally { socket.destroy(); }
const summary = { label, elapsedSeconds: (Date.now() - started) / 1000, audioSeconds: audioFrames / 48000, packets, zeroAudioSeconds: zeroFrames / 48000, maxAudioGapMs: maxGap,
  sourceChanges, syncedSnapshots: rows.filter(row => row.synced).length, snapshots: rows.length, meanBer: rows.reduce((sum, row) => sum + (row.ber || 0), 0) / rows.length };
let previousNative; const totals = { hdcPackets: 0, badHdcPackets: 0, pcmBlocks: 0, silentPcmBlocks: 0 }; let nativeRestarts = 0;
for (const row of rows) {
  const current = row.diagnostics?.native; if (!current) continue;
  if (previousNative) {
    const restarted = current.pcmBlocks < previousNative.pcmBlocks; nativeRestarts += restarted ? 1 : 0;
    for (const key of Object.keys(totals)) totals[key] += restarted ? current[key] : current[key] - previousNative[key];
  }
  previousNative = current;
}
if (previousNative) Object.assign(summary, totals, { nativeRestarts, finalDiagnostics: rows.at(-1).diagnostics });
fs.writeFileSync(new URL(`${label}-${started}.json`, root), JSON.stringify({ summary, rows }, null, 2)); console.log(JSON.stringify({ summary }));
