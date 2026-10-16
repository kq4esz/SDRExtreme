import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SOURCE = 'http://rx.linkfanel.net/kiwisdr_com.js';
const SOURCE_PAGE = 'http://rx.linkfanel.net/';
const CACHE_MS = 5 * 60 * 1000;

function plain(value, limit = 300) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
    const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&nbsp;', ' ').slice(0, limit);
}

export function parseKiwiDirectory(source) {
  // The public feed is a JS assignment. Parse only its JSON array; never execute it.
  const begin = source.indexOf('['), end = source.lastIndexOf(']');
  if (begin < 0 || end <= begin || !/\bkiwisdr_com\s*=\s*$/.test(source.slice(0, begin))) throw new Error('The receiver directory format has changed.');
  // The publisher emits a trailing comma after the final object. Remove only
  // that array delimiter; all receiver strings still go through JSON.parse.
  const json = source.slice(begin, end + 1).replace(/,\s*\]$/, ']');
  const rows = JSON.parse(json);
  if (!Array.isArray(rows)) throw new Error('Invalid receiver directory.');
  const seen = new Set();
  return rows.slice(0, 10000).flatMap(row => {
    let url;
    try { url = new URL(row.url); } catch { return []; }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return [];
    const gps = String(row.gps || '').match(/\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?/);
    const latitude = gps ? Number(gps[1]) : NaN, longitude = gps ? Number(gps[2]) : NaN;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    const canonical = url.origin + url.pathname.replace(/\/$/, '');
    if (seen.has(canonical)) return [];
    seen.add(canonical);
    const capacity = Math.max(0, Number(row.users_max) || 0), users = Math.max(0, Number(row.users) || 0);
    const online = row.offline !== 'yes' && row.status === 'active';
    const snrValues = String(row.snr || '').split(',').map(Number);
    const snr = Number.isFinite(snrValues[1]) ? snrValues[1] : null;
    const [minimum, maximum] = String(row.bands || '').split('-').map(Number);
    return [{ id: createHash('sha256').update(canonical).digest('hex').slice(0, 20), name: plain(row.name) || url.hostname,
      url: canonical, latitude, longitude, location: plain(row.loc), grid: plain(row.grid, 12),
      antenna: plain(row.antenna), hardware: plain(row.sdr_hw), users, capacity, available: Math.max(0, capacity - users),
      online, connectable: online && capacity > users, snr, minimum: minimum || 0, maximum: maximum || 30000000,
      updated: plain(row.updated, 80) }];
  });
}

export class KiwiDirectory {
  constructor(dataDir) {
    this.cacheFile = path.join(dataDir, 'kiwi-directory.json');
    try { const saved = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); if (Array.isArray(saved.receivers)) this.cache = saved; } catch {}
  }

  async list(force = false) {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_MS && (!force || Date.now() - this.cache.fetchedAt < 30000)) return this.result(false);
    if (this.pending) return this.pending;
    this.pending = this.refresh().finally(() => { this.pending = null; });
    return this.pending;
  }

  result(stale, warning) {
    return { receivers: this.cache?.receivers || [], fetchedAt: this.cache?.fetchedAt || null, source: SOURCE_PAGE,
      sourceName: 'KiwiSDR community directory · Pierre Ynard / Linkfanel', stale, ...(warning ? { warning } : {}) };
  }

  async refresh() {
    try {
      const response = await fetch(SOURCE, { headers: { 'user-agent': 'SignalOutpost/0.11 (personal receiver application)', accept: 'text/javascript, application/json, text/plain' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Directory returned HTTP ${response.status}.`);
      if (Number(response.headers.get('content-length')) > 4000000) throw new Error('Directory response is too large.');
      const text = await response.text();
      if (text.length > 4000000) throw new Error('Directory response is too large.');
      const receivers = parseKiwiDirectory(text);
      if (!receivers.length) throw new Error('The public directory currently contains no geolocated receivers.');
      this.cache = { receivers, fetchedAt: Date.now() };
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache));
      return this.result(false);
    } catch (error) {
      if (this.cache?.receivers.length) return this.result(true, `Showing the last saved directory. ${error.message}`);
      throw new Error(`Could not load public KiwiSDR receivers. ${error.message} Use Refresh to retry.`);
    }
  }

  async receiver(id) {
    await this.list();
    const receiver = this.cache.receivers.find(row => row.id === id);
    if (!receiver) throw new Error('That receiver is no longer in the public directory. Refresh the map and select another.');
    return receiver;
  }

  async check(id) {
    const receiver = await this.receiver(id);
    try {
      const response = await fetch(`${receiver.url}/status`, { signal: AbortSignal.timeout(6500), redirect: 'error', headers: { 'user-agent': 'SignalOutpost/0.11' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 60000 || !/^status=/m.test(text)) throw new Error('Status information unavailable');
      const values = Object.fromEntries(text.split(/\r?\n/).filter(line => line.includes('=')).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
      const users = Math.max(0, Number(values.users ?? receiver.users) || 0), capacity = Math.max(0, Number(values.users_max ?? receiver.capacity) || 0);
      const online = values.status === 'active' && values.offline !== 'yes';
      Object.assign(receiver, { users, capacity, available: Math.max(0, capacity - users), online, connectable: online && capacity > users });
      return { ...receiver, checkedAt: Date.now(), reachable: true };
    } catch (error) {
      return { ...receiver, checkedAt: Date.now(), reachable: false, warning: `Could not verify current availability (${error.message}). You can try opening the receiver or choose another station.` };
    }
  }
}
