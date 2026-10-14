import { DIGITAL_MODES, RECEIVER_MODES, digitalOptions, protocolLabel, resolveProtocol } from './channel-protocols.mjs';
import { hdMemoryOptions } from './hd-options.mjs';

function detectedProtocol(label) {
  const value = String(label || '').toUpperCase().replace(/[\s_-]/g, '');
  if (/P25P?1|P25PHASE1/.test(value)) return 'P25-1';
  if (/P25P?2|P25PHASE2/.test(value)) return 'P25-2';
  if (value.includes('NXDN48')) return 'NXDN48';
  if (value.includes('NXDN96')) return 'NXDN96';
  if (value === 'DMR' || value.startsWith('DMR')) return 'DMR';
  if (value === 'DSTAR') return 'D-STAR';
  if (value === 'YSF' || value === 'M17') return value;
  return null;
}

export function currentMemoryDraft({ status, channels = [], page, frequency, mode, hdProgram = 0, decoderChoice, selectedMemoryId, siteId }) {
  const active = Boolean(status?.digitalActive || status?.connected || status?.hdActive);
  const selected = active && status.scan?.channel?.frequency === status.frequency ? status.scan.channel : channels.find(channel => channel.id === (active ? status.selectedChannelId : selectedMemoryId));
  const site = !active && page === 'decoders' && selected?.kind === 'trunked' ? selected.sites?.find(item => String(item.id) === String(siteId)) || selected.sites?.[0] : null;
  const tuned = active ? Number(status.frequency) : site ? Number(site.frequencies?.find(item => item.use === 'd')?.frequency || site.frequencies?.[0]?.frequency || selected.frequency) : Number(frequency);
  if (!Number.isFinite(tuned) || tuned < 10000 || tuned > 1766000000) throw new Error('Choose a valid frequency before adding a memory.');
  let config = { mode: active ? status.mode : mode, hdProgram };
  if (status?.hdActive) config = { mode: 'HD', hdProgram: status.hd?.program || 0 };
  else if (status?.digitalActive) {
    config = { ...selected, ...status.digital?.config, mode: status.digital?.config?.mode || status.mode };
    const detected = detectedProtocol(status.digital?.decoderStatus?.protocol || status.digital?.system?.protocol);
    if (detected) config = resolveProtocol(detected, config);
    // A new conventional Phase 2 voice memory uses the QPSK voice demodulator.
    // Preserve all supplied identities; learn additional identities only from
    // the decoded current-site neighbor record and validated event records.
    const neighbor = status.digital?.system?.p25_neighbors?.find(site => site.current_cc);
    if (config.mode === 'P25' && neighbor) {
      if (!config.p25Wacn && Number.isInteger(neighbor.wacn)) config.p25Wacn = neighbor.wacn.toString(16);
      if (!config.p25SystemId && Number.isInteger(neighbor.sysid)) config.p25SystemId = neighbor.sysid.toString(16);
    }
    const identity = status.digital?.identity;
    if (config.mode === 'P25' && !config.p25Nac && identity?.frequency === tuned && Number.isInteger(identity.nac)) config.p25Nac = identity.nac.toString(16);
  } else if (!status?.connected && page === 'decoders') config = resolveProtocol(decoderChoice, selected || {});
  else if (DIGITAL_MODES.has(config.mode)) config = { ...selected, ...config };
  if (!RECEIVER_MODES.has(config.mode)) throw new Error('Choose a supported receiver mode before adding a memory.');
  if (DIGITAL_MODES.has(config.mode)) config = { ...config, ...digitalOptions(config) };
  if (config.mode === 'P25' && config.p25Phase === '2') config.p25Modulation = 'cqpsk';
  const label = protocolLabel(config);
  const call = status?.digitalActive ? status.digital?.calls?.find(item => item.state === 2 && (!item.frequency_hz || item.frequency_hz === tuned)) : null;
  const notes = [selected?.kind === 'trunked' ? `From ${selected.name}` : '', call?.tg_id ? `Talkgroup ${call.tg_id}` : '', call?.ota_source_id ? `Radio ${call.ota_source_id}` : ''].filter(Boolean).join(' · ');
  return { name: `${label} ${(tuned / 1e6).toFixed(6)}`, frequency: Math.round(tuned), mode: config.mode,
    kind: 'conventional', group: selected?.group || (config.mode === 'HD' ? 'Broadcast' : DIGITAL_MODES.has(config.mode) ? 'Digital' : 'General'),
    notes: notes.slice(0, 300), source: 'Receiver', ...(DIGITAL_MODES.has(config.mode) ? digitalOptions(config) : {}),
    ...(config.mode === 'HD' ? hdMemoryOptions({ frequency: tuned, hdProgram: config.hdProgram }) : {}) };
}
