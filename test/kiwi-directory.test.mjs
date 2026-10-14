import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KiwiDirectory, parseKiwiDirectory } from '../lib/kiwi-directory.mjs';

const receiver = { name: 'Test receiver', url: 'http://sdr.example.org:8073/', gps: '(37.5, -78.5)', status: 'active', offline: 'no', users: '2', users_max: '4', snr: '31,28', bands: '10000-32000000' };
const feed = rows => '// Published directory\nvar kiwisdr_com =\n' + JSON.stringify(rows).replace(/\]$/, ',\n]') + ';\n';

test('reads the actual feed format, including its final trailing comma', () => {
  const [row] = parseKiwiDirectory(feed([receiver]));
  assert.equal(row.url, 'http://sdr.example.org:8073');
  assert.equal(row.latitude, 37.5); assert.equal(row.longitude, -78.5);
  assert.equal(row.available, 2); assert.equal(row.connectable, true); assert.equal(row.snr, 28);
  assert.equal(row.maximum, 32000000); assert.match(row.id, /^[a-f0-9]{20}$/);
});

test('rejects executable feed data instead of evaluating it', () => {
  globalThis.__kiwiExecuted = false;
  assert.throws(() => parseKiwiDirectory('var kiwisdr_com = [globalThis.__kiwiExecuted = true];'));
  assert.equal(globalThis.__kiwiExecuted, false); delete globalThis.__kiwiExecuted;
});

test('drops invalid coordinates, unsafe URLs, embedded credentials and duplicates', () => {
  const rows = parseKiwiDirectory(feed([receiver, receiver, { ...receiver, url: 'javascript:alert(1)' }, { ...receiver, url: 'http://user:password@example.org/' }, { ...receiver, url: 'http://other.example.org/', gps: '(999, 3)' }]));
  assert.equal(rows.length, 1);
});

test('does not advertise full or offline receivers as connectable', () => {
  const rows = parseKiwiDirectory(feed([{ ...receiver, users: '4' }, { ...receiver, url: 'http://offline.example.org/', offline: 'yes' }]));
  assert.equal(rows[0].available, 0); assert.equal(rows[0].connectable, false); assert.equal(rows[1].online, false);
});

test('preserves text containing punctuation and strips station markup', () => {
  const [row] = parseKiwiDirectory(feed([{ ...receiver, name: '<b>Test &amp; receiver</b>', antenna: 'Wire, ] antenna' }]));
  assert.equal(row.name, 'Test & receiver'); assert.equal(row.antenna, 'Wire, ] antenna');
});

test('uses saved directory data when the live feed is unavailable', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdr-directory-test-'));
  const originalFetch = globalThis.fetch;
  try {
    const rows = parseKiwiDirectory(feed([receiver]));
    fs.writeFileSync(path.join(temp, 'kiwi-directory.json'), JSON.stringify({ receivers: rows, fetchedAt: 1 }));
    globalThis.fetch = async () => { throw new Error('Network unavailable'); };
    const result = await new KiwiDirectory(temp).list();
    assert.equal(result.stale, true); assert.equal(result.receivers.length, 1); assert.match(result.warning, /last saved directory/);
  } finally { globalThis.fetch = originalFetch; fs.unlinkSync(path.join(temp, 'kiwi-directory.json')); fs.rmdirSync(temp); }
});
