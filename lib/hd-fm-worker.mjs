import { parentPort } from 'node:worker_threads';
import { BroadcastFm } from './broadcast-fm.mjs';

const fm = new BroadcastFm();
parentPort.on('message', message => {
  const iq = new Uint8Array(message.iq);
  const samples = fm.push(iq);
  parentPort.postMessage({ samples: samples.buffer, length: samples.length, consumed: iq.byteLength }, [samples.buffer]);
});
