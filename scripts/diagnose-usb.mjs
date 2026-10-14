import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listUsbDevices, UsbReceiver } from '../lib/rtl-usb.mjs';

let settings = {};
try { settings = JSON.parse(fs.readFileSync(new URL('../local-data/settings.json', import.meta.url))); } catch {}
const discovery = await listUsbDevices(settings.rtlLibraryPath);
if (!discovery.available || !discovery.devices.length) throw new Error(discovery.error || 'No RTL-SDR USB receiver is attached.');
const selected = discovery.devices.find(device => device.serial === settings.deviceSerial) || discovery.devices[0];
const usb = new UsbReceiver(); let samples = 0;
usb.on('iq', block => { samples += block.length / 2; });
usb.on('log', message => console.log('Driver:', message));
try {
  const info = await usb.start({ deviceIndex: selected.index, deviceSerial: selected.serial, libraryPath: settings.rtlLibraryPath,
    frequency: 100000000, sampleRate: 2400000, gain: 0, ppm: 0, rtlAgc: false, directSampling: 0, biasTee: false });
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.ok(samples >= 32768, 'The receiver must deliver real IQ samples.');
  assert.equal(await usb.command('frequency', 100100000), 100100000);
  const gain = await usb.command('gain', 200);
  assert.ok(info.gains.includes(gain), 'Manual gain must use a supported tuner gain.');
  console.log(JSON.stringify({ device: info.product, serial: info.serial, transport: info.transport, sampleRate: info.sampleRate, receivedComplexSamples: samples, appliedGainDb: gain / 10 }, null, 2));
} finally { await usb.close(); }
assert.equal(usb.connected, false);
console.log('PASS: native USB open, IQ reception, retune, gain, and close.');
