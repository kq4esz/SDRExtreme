import { createHash, createCipheriv, createHmac } from 'node:crypto';
import { meshPath, relayMatches } from './meshcore-paths.mjs';

const CACHE_AGE = 10 * 60_000;
const MAX_PACKETS = 128, MAX_SAMPLES = 8, MAX_PATHS = 8, MAX_REPEATERS = 64, MAX_IDS = 256;
const digest = payload => createHash('sha256').update(Buffer.from([5])).update(payload).digest('hex');

// Match the firmware's group-text payload exactly. The changing path and route
// header are excluded from its packet hash (MeshCore Packet::calculatePacketHash).
function channelFingerprint(secret, timestamp, text, flags = 0) {
  if (!secret || !Number.isInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffff || flags !== 0) return null;
  const body = Buffer.from(text, 'utf8').subarray(0, 160);
  const plain = Buffer.alloc(Math.ceil((5 + body.length) / 16) * 16);
  plain.writeUInt32LE(timestamp); plain[4] = flags; body.copy(plain, 5);
  const cipher = createCipheriv('aes-128-ecb', secret.subarray(0, 16), null); cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const mac = createHmac('sha256', secret).update(encrypted).digest().subarray(0, 2);
  const keyLength = secret.subarray(16).some(byte => byte !== 0) ? 32 : 16;
  const channelHash = createHash('sha256').update(secret.subarray(0, keyLength)).digest().subarray(0, 1);
  return digest(Buffer.concat([channelHash, mac, encrypted]));
}

function floodObservation(data) {
  const raw = Buffer.from(data.raw || []);
  if (raw.length < 21 || raw.length > 255 || raw[0] >> 6 !== 0 || ((raw[0] >> 2) & 15) !== 5) return null;
  const type = raw[0] & 3;
  if (type !== 0 && type !== 1) return null; // Routed paths consume relay IDs.
  let offset = type === 0 ? 5 : 1;
  if (offset >= raw.length) return null;
  const route = meshPath(raw[offset++], raw.subarray(offset));
  if (route.kind !== 'direct') return null;
  offset += route.hashBytes * route.hops;
  const payload = raw.subarray(offset);
  if (payload.length < 19 || (payload.length - 3) % 16) return null;
  return { packetId: digest(payload), source: 'channel-rx-log', kind: 'observed-flood', hops: route.hops,
    hashBytes: route.hashBytes, hashes: route.hashes, observedAt: Date.now(),
    snr: Number.isFinite(data.lastSnr) ? data.lastSnr : null, rssi: Number.isFinite(data.lastRssi) ? data.lastRssi : null };
}

export class MeshObservations {
  #channelSecrets = new Map();
  constructor(client) { this.client = client; this.watched = new Map(); this.cache = new Map(); }
  setChannel(index, bytes) {
    this.#channelSecrets.get(index)?.fill(0); this.#channelSecrets.delete(index);
    if (![16, 32].includes(bytes.length)) return;
    const secret = Buffer.alloc(32); Buffer.from(bytes).copy(secret); this.#channelSecrets.set(index, secret);
  }
  clearChannels() { for (const secret of this.#channelSecrets.values()) secret.fill(0); this.#channelSecrets.clear(); }
  fingerprint(index, timestamp, text, flags = 0) {
    try { return channelFingerprint(this.#channelSecrets.get(index), timestamp, text, flags); }
    catch { return null; } // Optional RF evidence must never prevent a send.
  }
  trackOutgoing(row, attempt, index) {
    const packetId = this.fingerprint(index, row.timestamp, `${row.delivery.sourceName}: ${row.text}`);
    row.delivery.rebroadcast ||= { available: Boolean(packetId), repeatCount: 0, repeaterCount: 0, repeaters: [], paths: [] };
    if (!packetId) return;
    row.delivery.rebroadcast.available = true; attempt.packetId = packetId;
    this.watch(packetId, row, attempt.transmittedAt);
  }
  ownEcho(data) {
    const id = this.fingerprint(data.channelIdx, data.senderTimestamp, data.text, data.txtType);
    const row = id && this.watched.get(id)?.row;
    return row?.node === this.client.node?.publicKey && row.direction === 'out';
  }
  trackIncoming(row, data) {
    const id = this.fingerprint(data.channelIdx, data.senderTimestamp, data.text, data.txtType);
    if (id) this.watch(id, row, 0);
  }
  watch(packetId, row, earliest) {
    const previous = this.watched.get(packetId);
    if (previous?.row === row) return; // A rejected channel attempt reuses its packet.
    this.watched.set(packetId, { row, earliest, ids: new Set(), createdAt: Date.now() });
    if (this.watched.size > 256) this.watched.delete(this.watched.keys().next().value);
    for (const observation of this.cache.get(packetId) || []) this.apply(this.watched.get(packetId), observation);
  }
  observe(data) {
    const observation = floodObservation(data);
    if (!observation) return;
    const now = Date.now();
    for (const [id, samples] of this.cache) if (now - samples.at(-1).observedAt > CACHE_AGE) this.cache.delete(id);
    const samples = this.cache.get(observation.packetId) || [];
    samples.push(observation); if (samples.length > MAX_SAMPLES) samples.shift();
    this.cache.delete(observation.packetId); this.cache.set(observation.packetId, samples);
    if (this.cache.size > MAX_PACKETS) this.cache.delete(this.cache.keys().next().value);
    const watched = this.watched.get(observation.packetId);
    if (watched && watched.row.node === this.client.node?.publicKey && this.client.history.includes(watched.row)) this.apply(watched, observation);
  }
  apply(watched, observation) {
    const { row } = watched;
    if (observation.observedAt < watched.earliest) return;
    if (row.direction === 'in') {
      // A later repeated copy can have a different path. Preserve the hop count
      // supplied with the delivered message, and label the RX path as a copy.
      if (row.reception.path || observation.hops !== row.reception.hops || observation.hashBytes !== row.reception.hashBytes ||
        (Number.isFinite(row.snr) && row.snr !== observation.snr)) return;
      row.reception.path = observation; row.reception.revision++;
    } else {
      if (!observation.hops) return; // No repeater appended an ID.
      const evidence = row.delivery.rebroadcast, hash = observation.hashes.at(-1), id = `${observation.hashBytes}:${hash}`;
      evidence.repeatCount++; evidence.lastHeardAt = observation.observedAt;
      evidence.firstHeardAt ||= observation.observedAt;
      if (watched.ids.size < MAX_IDS) watched.ids.add(id);
      else if (!watched.ids.has(id)) evidence.countLimited = true;
      evidence.repeaterCount = watched.ids.size;
      let relay = evidence.repeaters.find(value => value.hash === hash && value.hashBytes === observation.hashBytes);
      if (!relay && evidence.repeaters.length < MAX_REPEATERS) {
        relay = { hash, hashBytes: observation.hashBytes, firstHeardAt: observation.observedAt, copies: 0, matches: relayMatches(hash, this.client.contacts) };
        evidence.repeaters.push(relay);
      }
      if (relay) {
        relay.copies++; relay.lastHeardAt = observation.observedAt; relay.snr = observation.snr; relay.rssi = observation.rssi;
        if (!relay.matches.length) relay.matches = relayMatches(hash, this.client.contacts);
      } else evidence.repeatersLimited = true;
      const signature = `${observation.hashBytes}:${observation.hashes.join(',')}`;
      const recorded = evidence.paths.find(value => value.signature === signature);
      if (recorded) { recorded.copies++; recorded.lastHeardAt = observation.observedAt; }
      else if (evidence.paths.length < MAX_PATHS) evidence.paths.push({ ...observation, signature, copies: 1, lastHeardAt: observation.observedAt });
      else evidence.pathsLimited = true;
      row.delivery.revision++;
    }
    // Coalesce RF observations so repeated packets don't rewrite all chat
    // history or rebuild the conversation on every individual radio log event.
    this.flushTimer ||= setTimeout(() => { this.flushTimer = null; this.client.save(); this.client.publish(); }, 250);
    this.flushTimer.unref();
  }
  stop() { clearTimeout(this.flushTimer); this.flushTimer = null; this.clearChannels(); this.watched.clear(); this.cache.clear(); }
}
