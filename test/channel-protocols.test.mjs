import test from 'node:test';
import assert from 'node:assert/strict';
import { digitalOptions, decoderFlags, protocolChoice, resolveProtocol, siteFrequencies, channelMapRows, digitalScanProfile, importedProtocol } from '../lib/channel-protocols.mjs';
import { normalizeMemory } from '../lib/memory-channels.mjs';

test('P25 Phase 1 and Phase 2 trunking use the appropriate control demodulator', () => {
  assert.deepEqual(decoderFlags({ mode: 'P25', kind: 'trunked', p25Phase: '1' }), ['-f1', '-ma']);
  const flags = decoderFlags({ mode: 'P25', kind: 'trunked', p25Phase: '2', p25Control: 'phase1', p25Modulation: 'cqpsk' });
  assert.deepEqual(flags, ['-ft', '-mq']); assert.ok(!flags.includes('-f2'));
  assert.deepEqual(decoderFlags({ mode: 'P25', kind: 'trunked', p25Phase: '2', p25Control: 'phase2' }), ['-f2', '-m2']);
});

test('Phase 2 direct voice uses the configured WACN, system ID and NAC', () => {
  assert.deepEqual(decoderFlags({ mode: 'P25', p25Phase: '2', p25Wacn: 'bee00', p25SystemId: 'abc', p25Nac: '123' }), ['-f2', '-m2', '-X', 'BEE00ABC123']);
  assert.throws(() => digitalOptions({ p25Wacn: 'not-hex' }), /WACN/);
  assert.throws(() => digitalOptions({ mode: 'P25', p25Phase: '1', p25Control: 'phase2' }), /Phase 1/);
});

test('NXDN48 and NXDN96 have distinct decoder flags and saved choices', () => {
  assert.deepEqual(decoderFlags(resolveProtocol('NXDN48')), ['-fi']);
  assert.deepEqual(decoderFlags(resolveProtocol('NXDN96')), ['-fn']);
  assert.equal(protocolChoice({ mode: 'NXDN', nxdnMode: 'NXDN96' }), 'NXDN96');
  assert.equal(resolveProtocol('NDXN96').nxdnMode, 'NXDN96');
});

test('saved memory protocol settings survive normalization and editing', () => {
  const channel = normalizeMemory({ name: 'P25 site', frequency: 851012500, mode: 'P25', kind: 'trunked', p25Phase: '2', p25Control: 'phase1' });
  assert.equal(channel.p25Phase, '2'); assert.equal(channel.sites[0].frequencies[0].frequency, 851012500);
  const updated = normalizeMemory({ ...channel, name: 'Updated site', sites: [...channel.sites, { id: 'other', name: 'Other site', frequencies: [{ frequency: 852012500, lcn: 0 }] }], talkgroups: [{ id: '1001', alpha: 'Dispatch' }] }, false);
  assert.equal(updated.id, channel.id); assert.equal(updated.p25Control, 'phase1'); assert.equal(updated.sites.length, 2); assert.equal(updated.sites[1].frequencies[0].lcn, 0); assert.equal(updated.talkgroups[0].id, '1001');
  assert.throws(() => normalizeMemory({ name: 'Bad trunk', frequency: 851012500, mode: 'NFM', kind: 'trunked' }), /digital protocol/);
});

test('site frequency editing preserves real channel numbers including zero', () => {
  const rows = siteFrequencies('0, 851.012500, control\n12, 852.025000, voice\n13, 853.100000, alternate', 853100000);
  assert.equal(rows[0].frequency, 853100000); assert.equal(rows[0].use, 'd');
  const csv = channelMapRows({ frequencies: rows }, 853100000);
  assert.ok(csv.includes('0,851012500')); assert.ok(csv.includes('12,852025000'));
  assert.throws(() => siteFrequencies('not a frequency', 851012500), /line 1/);
  assert.throws(() => channelMapRows({ frequencies: [{ lcn: 12, frequency: 851000000 }, { lcn: 12, frequency: 852000000 }] }, 851000000), /more than one/);
});

test('bootstrap control map entry does not overwrite a real LCN 999', () => {
  const csv = channelMapRows({ frequencies: [{ lcn: 999, frequency: 852000000 }] }, 851000000);
  assert.ok(csv.includes('999,852000000')); assert.match(csv[1], /^1000,851000000/);
});

test('digital scan grouping rejects incompatible NXDN variants and allows P25/DMR', () => {
  assert.throws(() => digitalScanProfile([{ mode: 'NXDN', nxdnMode: 'NXDN48' }, { mode: 'NXDN', nxdnMode: 'NXDN96' }]), /matching protocols/);
  assert.deepEqual(digitalScanProfile([{ mode: 'P25', p25Phase: '1' }, { mode: 'DMR' }]).flags, ['-ft', '-ma']);
  assert.deepEqual(digitalScanProfile([{ mode: 'NXDN', nxdnMode: 'NXDN96' }]).flags, ['-fn']);
});

test('RadioReference metadata retains explicit phase and NXDN rate when present', () => {
  assert.equal(importedProtocol('Project 25 Phase II').p25Phase, '2');
  assert.equal(importedProtocol('P25', [{ mode: 'T' }]).p25Phase, '2');
  assert.equal(importedProtocol('NXDN 9600').nxdnMode, 'NXDN96');
  assert.equal(importedProtocol('Project 25').p25Phase, 'auto');
});
