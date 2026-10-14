import test from 'node:test';
import assert from 'node:assert/strict';
import { scanPlan, MemoryScanner, spectrumSnr } from '../lib/memory-scanner.mjs';

const memories = [
  { id: 'a', name: 'A', mode: 'NFM', kind: 'conventional', frequency: 146520000 },
  { id: 'b', name: 'B', mode: 'AM', kind: 'conventional', frequency: 121500000 },
  { id: 'c', name: 'C', mode: 'NFM', kind: 'conventional', frequency: 162550000 },
  { id: 't', name: 'Trunk', mode: 'P25', kind: 'trunked', frequency: 851012500 }
];
function clock() {
  let time = 0, next = 0; const jobs = new Map();
  return { now: () => time, schedule: (fn, ms) => { const id = ++next; jobs.set(id, { fn, at: time + ms }); return id; }, cancel: id => jobs.delete(id),
    tick: async ms => { const target = time + ms; while (true) { const job = [...jobs].sort((a, b) => a[1].at - b[1].at).find(([, item]) => item.at <= target); if (!job) break; jobs.delete(job[0]); time = job[1].at; await job[1].fn(); } time = target; }, pending: () => jobs.size };
}

test('scan planning scans only explicit selected memories and rejects empty or missing selections', () => {
  assert.deepEqual(scanPlan(memories, { channelIds: ['c', 'a', 'c'], rapid: true }).channelIds, ['c', 'a']);
  assert.equal(scanPlan(memories, { channelIds: ['a'], rapid: true, dwellMs: 1 }).dwellMs, 80);
  assert.throws(() => scanPlan(memories, { channelIds: [] }), /Select at least one/);
  assert.throws(() => scanPlan(memories, { channelIds: ['gone'] }), /no longer exists/);
  assert.throws(() => scanPlan(memories, { channelIds: ['t'] }), /control channel/);
});

test('native and digital memories are not silently mixed or skipped', () => {
  const list = [...memories, { id: 'p', mode: 'P25', p25Phase: '1', kind: 'conventional', frequency: 453000000 }];
  assert.throws(() => scanPlan(list, { channelIds: ['a', 'p'] }), /separate scan groups/);
  assert.equal(scanPlan(list, { channelIds: ['p'] }).engine, 'digital');
});

test('rapid scanning visits only selected channels and stops all queued tuning', async () => {
  const time = clock(), visits = [];
  const scanner = new MemoryScanner(scanPlan(memories, { channelIds: ['b', 'a'], rapid: true, dwellMs: 150, holdOnSignal: false }), { ...time, tune: async channel => visits.push(channel.id) });
  await scanner.start(); await time.tick(450);
  assert.deepEqual(visits, ['b', 'a', 'b', 'a']); assert.equal(scanner.snapshot().hops, 4);
  scanner.stop(); await time.tick(1000); assert.equal(visits.length, 4); assert.equal(time.pending(), 0);
});

test('an active signal holds and scanning resumes after silence', async () => {
  const time = clock(), visits = [], events = [];
  const scanner = new MemoryScanner(scanPlan(memories, { channelIds: ['a', 'b'], rapid: true, dwellMs: 150, holdMs: 500 }), { ...time, tune: async channel => visits.push(channel.id), event: type => events.push(type) });
  await scanner.start(); await time.tick(50); scanner.observe(15); await time.tick(50); scanner.observe(15);
  assert.equal(scanner.holding, true); assert.ok(events.includes('scan-hold'));
  await time.tick(300); assert.equal(visits.length, 1);
  await time.tick(350); assert.ok(visits.length >= 2); scanner.stop();
});

test('skip leaves a held signal and goes to the next selected memory', async () => {
  const time = clock(), visits = [];
  const scanner = new MemoryScanner(scanPlan(memories, { channelIds: ['a', 'c'], rapid: true, dwellMs: 80 }), { ...time, tune: async channel => visits.push(channel.id) });
  await scanner.start(); await time.tick(45); scanner.observe(20); assert.equal(scanner.holding, true);
  await scanner.skip(); assert.deepEqual(visits, ['a', 'c']); assert.equal(scanner.holding, false); scanner.stop();
});

test('stopping an in-flight tune prevents its completion from restarting scanning', async () => {
  const time = clock(); let finish; const blocked = new Promise(resolve => { finish = resolve; });
  const scanner = new MemoryScanner(scanPlan(memories, { channelIds: ['a'], rapid: true }), { ...time, tune: () => blocked });
  const starting = scanner.start(); scanner.stop(); finish(); await starting;
  assert.equal(scanner.active, false); assert.equal(scanner.hops, 0); assert.equal(time.pending(), 0);
});

test('device errors stop scanning and reach the caller', async () => {
  const time = clock(); let reported;
  const scanner = new MemoryScanner(scanPlan(memories, { channelIds: ['a'] }), { ...time, tune: async () => { throw new Error('USB unplugged'); }, error: error => { reported = error; } });
  await assert.rejects(scanner.start(), /USB unplugged/); assert.equal(reported.message, 'USB unplugged'); assert.equal(scanner.active, false);
});

test('signal detection uses channel energy above nearby noise and excludes center DC', () => {
  const bins = Array(1024).fill(-90); bins[512] = -10;
  assert.equal(spectrumSnr(bins, 2400000, 'NFM'), 0);
  bins[511] = bins[513] = bins[514] = -40;
  assert.ok(spectrumSnr(bins, 2400000, 'NFM') > 40);
});
