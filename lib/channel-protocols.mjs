export const DIGITAL_MODES = new Set(['P25', 'DMR', 'NXDN', 'D-STAR', 'YSF', 'M17']);
export const RECEIVER_MODES = new Set(['AM', 'NFM', 'WFM', 'USB', 'LSB', 'CW', 'RAW', 'HD', ...DIGITAL_MODES]);

function choice(value, allowed, fallback, name) {
  const result = String(value ?? fallback);
  if (!allowed.includes(result)) throw new Error(`Choose a valid ${name}.`);
  return result;
}
function hex(value, width, name) {
  const result = String(value || '').trim().replace(/^0x/i, '').toUpperCase();
  if (!result) return '';
  if (!new RegExp(`^[0-9A-F]{1,${width}}$`).test(result)) throw new Error(`${name} must contain up to ${width} hexadecimal digits.`);
  return result.padStart(width, '0');
}

export function digitalOptions(value = {}) {
  const p25Phase = choice(value.p25Phase, ['auto', '1', '2'], 'auto', 'P25 phase');
  const p25Control = choice(value.p25Control, ['phase1', 'phase2'], 'phase1', 'P25 control channel type');
  if (value.mode === 'P25' && p25Phase === '1' && p25Control === 'phase2') throw new Error('A Phase 1 P25 system requires a Phase 1 control channel.');
  return {
    p25Phase, p25Control,
    p25Modulation: choice(value.p25Modulation, ['auto', 'c4fm', 'cqpsk'], 'auto', 'P25 modulation'),
    p25Wacn: hex(value.p25Wacn, 5, 'WACN'), p25SystemId: hex(value.p25SystemId, 3, 'P25 system ID'), p25Nac: hex(value.p25Nac, 3, 'NAC'),
    nxdnMode: choice(String(value.nxdnMode || 'NXDN48').toUpperCase().replace('NDXN', 'NXDN'), ['NXDN48', 'NXDN96'], 'NXDN48', 'NXDN protocol')
  };
}

export function protocolLabel(channel = {}) {
  if (channel.mode === 'HD') return `HD Radio · HD${(Number(channel.hdProgram) || 0) + 1}`;
  if (channel.mode === 'P25') return channel.p25Phase === '1' ? 'P25 Phase 1' : channel.p25Phase === '2' ? 'P25 Phase 2' : 'P25 Auto';
  if (channel.mode === 'NXDN') return channel.nxdnMode || 'NXDN48';
  return channel.mode || 'NFM';
}

export function protocolChoice(channel = {}) {
  if (channel.mode === 'P25') return channel.p25Phase === '1' ? 'P25-1' : channel.p25Phase === '2' ? 'P25-2' : 'P25';
  if (channel.mode === 'NXDN') return channel.nxdnMode || 'NXDN48';
  return channel.mode || 'auto';
}

export function resolveProtocol(value, base = {}) {
  const selected = String(value || 'auto').toUpperCase();
  const config = { ...base };
  if (selected === 'P25-1') { config.mode = 'P25'; config.p25Phase = '1'; config.p25Control = 'phase1'; }
  else if (selected === 'P25-2') { config.mode = 'P25'; config.p25Phase = '2'; }
  else if (selected === 'NXDN48' || selected === 'NXDN96' || selected === 'NDXN96') { config.mode = 'NXDN'; config.nxdnMode = selected.replace('NDXN', 'NXDN'); }
  else if (selected !== 'AUTO') {
    if (!DIGITAL_MODES.has(selected)) throw new Error('Choose a supported digital protocol.');
    config.mode = selected;
  }
  if (!DIGITAL_MODES.has(config.mode)) config.mode = 'P25';
  return { ...config, ...digitalOptions(config) };
}

export function decoderFlags(channel, { trunked = channel.kind === 'trunked' } = {}) {
  const config = { ...channel, ...digitalOptions(channel) };
  if (config.mode === 'NXDN') return [config.nxdnMode === 'NXDN96' ? '-fn' : '-fi'];
  if (config.mode !== 'P25') return { DMR: ['-fs'], 'D-STAR': ['-fd'], YSF: ['-fy'], M17: ['-fz'] }[config.mode] || ['-ft'];
  // Phase 2 voice systems commonly use a 4800-symbol/s Phase 1 control channel.
  // -ft follows that control channel and can switch to Phase 2 traffic. -f2
  // would miss it, so reserve -f2/-m2 for TDMA control or direct Phase 2 voice.
  const tdma = config.p25Phase === '2' && (!trunked || config.p25Control === 'phase2');
  const flags = tdma ? ['-f2', '-m2'] : [config.p25Phase === '1' ? '-f1' : '-ft', { auto: '-ma', c4fm: '-mc', cqpsk: '-mq' }[config.p25Modulation]];
  if (config.p25Phase === '2' && config.p25Wacn && config.p25SystemId && config.p25Nac) flags.push('-X', config.p25Wacn + config.p25SystemId + config.p25Nac);
  return flags;
}

export function digitalScanProfile(channels) {
  if (!channels.length) throw new Error('Select at least one digital conventional memory.');
  const modes = new Set(channels.map(channel => channel.mode));
  if ([...modes].every(mode => ['P25', 'DMR'].includes(mode)) && (modes.size > 1 || new Set(channels.map(channel => channel.p25Phase || 'auto')).size > 1)) {
    if (channels.some(channel => channel.p25Wacn || channel.p25SystemId || channel.p25Nac)) throw new Error('Scan P25 memories with manual Phase 2 identities in a separate matching group.');
    return { mode: 'P25', p25Phase: 'auto', p25Modulation: 'auto', flags: ['-ft', '-ma'] };
  }
  const first = { ...channels[0], ...digitalOptions(channels[0]) };
  const flags = decoderFlags(first, { trunked: false });
  if (channels.some(channel => JSON.stringify(decoderFlags(channel, { trunked: false })) !== JSON.stringify(flags))) throw new Error('These decoder settings cannot share one scan. Select matching protocols, such as only NXDN48 or only NXDN96.');
  return { ...first, flags };
}

export function siteFrequencies(text, primaryFrequency) {
  const rows = [];
  for (const [index, raw] of String(text || '').split(/\r?\n/).entries()) {
    const line = raw.trim(); if (!line) continue;
    const parts = line.split(',').map(item => item.trim());
    const hasLcn = parts.length > 1 && /^\d+$/.test(parts[0]) && Number(parts[1]) > 0;
    const frequency = Math.round(Number(parts[hasLcn ? 1 : 0]) * 1e6);
    if (!Number.isFinite(frequency) || frequency < 10000 || frequency > 1766000000) throw new Error(`Site frequency on line ${index + 1} must be in MHz.`);
    const lcn = hasLcn ? Number(parts[0]) : null;
    if (lcn !== null && (lcn < 0 || lcn > 65535)) throw new Error(`Invalid LCN on line ${index + 1}.`);
    const role = (parts[hasLcn ? 2 : 1] || '').toLowerCase();
    const use = ['control', 'c', 'd'].includes(role) ? 'd' : ['alternate', 'a'].includes(role) ? 'a' : '';
    if (!rows.some(row => row.frequency === frequency && row.lcn === lcn)) rows.push({ frequency, lcn, use });
  }
  if (!rows.some(row => row.frequency === primaryFrequency)) rows.unshift({ frequency: primaryFrequency, lcn: null, use: 'd' });
  else { const index = rows.findIndex(row => row.frequency === primaryFrequency); const [primary] = rows.splice(index, 1); primary.use = 'd'; rows.unshift(primary); }
  if (rows.length > 256) throw new Error('Limit each site to 256 frequencies.');
  return rows;
}

export function channelMapRows(site, frequency) {
  const existing = new Set((site.frequencies || []).filter(item => item.lcn !== null && item.lcn !== undefined && item.lcn !== '').map(item => Number(item.lcn)));
  let bootstrap = 999; while (existing.has(bootstrap) && bootstrap < 65535) bootstrap++;
  const rows = ['ChannelNumber(dec),frequency(Hz) (do not delete this line or it will not import properly)', `${bootstrap},${frequency},control channel`];
  const used = new Map([[bootstrap, frequency]]);
  for (const [index, item] of (site.frequencies || []).entries()) {
    const explicit = item.lcn !== '' && item.lcn !== null && item.lcn !== undefined;
    if (!explicit && Number(item.frequency) === frequency) continue;
    const lcn = explicit ? Number(item.lcn) : index + 1;
    if (!Number.isInteger(lcn) || lcn < 0 || lcn > 65535) throw new Error('Each site LCN must be an integer between 0 and 65535.');
    if (used.has(lcn) && used.get(lcn) !== Number(item.frequency)) throw new Error(`Site LCN ${lcn} is assigned to more than one frequency.`);
    if (used.has(lcn)) continue;
    used.set(lcn, Number(item.frequency)); rows.push(`${lcn},${item.frequency}`);
  }
  return rows;
}

export function importedProtocol(description, talkgroups = []) {
  const text = String(description || '').toUpperCase();
  if (text.includes('NXDN')) return { mode: 'NXDN', ...digitalOptions({ nxdnMode: /NXDN\s*(?:96|9600)|9600\s*BPS/.test(text) ? 'NXDN96' : 'NXDN48' }) };
  if (text.includes('DMR')) return { mode: 'DMR', ...digitalOptions() };
  const phase2 = /PHASE\s*(?:2\b|II\b)|TDMA/.test(text) || talkgroups.some(group => /^T(?:E)?$/i.test(String(group.mode || '')));
  return { mode: 'P25', ...digitalOptions({ p25Phase: phase2 ? '2' : /PHASE\s*(?:1\b|I\b)/.test(text) ? '1' : 'auto' }) };
}
