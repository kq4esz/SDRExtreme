import { randomUUID, createHash } from 'node:crypto';
import { Constants } from '@liamcottle/meshcore.js';
import { pathSnapshot, observedAckPath } from './meshcore-paths.mjs';

const R = Constants.ResponseCodes;
export const MESSAGE_ATTEMPTS = 4;
export const CHANNEL_TRANSMISSIONS = 1;
export const PENDING_DELIVERY_STATES = ['queued', 'sending', 'awaiting-ack', 'retry-wait'];

function expectedAck(node, row, attempt) {
  const prefix = Buffer.alloc(5); prefix.writeUInt32LE(row.timestamp, 0); prefix[4] = attempt & 3;
  return createHash('sha256').update(prefix).update(Buffer.from(row.text)).update(Buffer.from(node, 'hex')).digest().readUInt32LE(0);
}

export class MeshDelivery {
  constructor(client) { this.client = client; this.queue = []; this.active = null; this.cycle = 0; this.ackPaths = new Map(); }
  changed(row) { row.delivery.revision++; this.client.save(); this.client.publish(); }
  add({ recipient, text, channel }) {
    if (this.queue.length + Number(Boolean(this.active)) >= 32) throw new Error('The outgoing message queue is full. Wait for a delivery to finish.');
    const client = this.client;
    client.lastSendTimestamp = Math.max(Math.floor(Date.now() / 1000), (client.lastSendTimestamp || 0) + 1);
    const row = { id: randomUUID(), node: client.node.publicKey, recipient, direction: 'out', text,
      timestamp: client.lastSendTimestamp, status: 'queued', delivery: { revision: 0, type: channel ? 'channel' : 'direct',
        maxAttempts: MESSAGE_ATTEMPTS, sourceName: client.node.name,
        destinationName: channel ? client.channels.find(value => recipient === `channel:${value.index}`)?.name : client.contacts.find(value => recipient === `contact:${value.publicKey}`)?.name,
        attempts: [], receipt: { kind: channel ? 'unavailable' : 'pending' } } };
    client.history.push(row); this.queue.push(row); this.changed(row); void this.pump(); return row;
  }
  async pump() {
    if (this.active || !this.queue.length) return;
    const client = this.client, row = this.queue.shift(), cycle = this.cycle, generation = client.generation;
    this.active = row;
    try { await this.run(row, generation, cycle); }
    catch (error) {
      if (cycle === this.cycle && row.status !== 'delivered') {
        row.status = 'unconfirmed'; row.error = error.message; this.changed(row);
        if (error.fatal) client.fail(error, generation);
      }
    } finally {
      if (cycle === this.cycle) { this.active = null; this.wake = null; clearTimeout(this.timer); void this.pump(); }
    }
  }
  current(row, generation, cycle) { return this.cycle === cycle && this.client.generation === generation && this.client.phase === 'connected' && row.status !== 'delivered'; }
  pause(ms) {
    return new Promise(resolve => {
      this.wake = () => { clearTimeout(this.timer); this.timer = null; this.wake = null; resolve(); };
      this.timer = setTimeout(this.wake, ms); this.timer.unref();
    });
  }
  async run(row, generation, cycle) {
    const client = this.client, channel = row.delivery.type === 'channel';
    for (let index = 0; index < MESSAGE_ATTEMPTS && this.current(row, generation, cycle); index++) {
      const attempt = { number: index + 1, startedAt: Date.now(), state: 'sending' };
      row.delivery.attempts.push(attempt); row.status = 'sending'; delete row.error;
      if (!channel) attempt.ackCode = expectedAck(row.node, row, index);
      this.changed(row);
      try {
        let skipped = false;
        const result = await client.enqueue(async () => {
          if (!this.current(row, generation, cycle)) { skipped = true; return; }
          let contact = null, targetChannel = null;
          if (channel) targetChannel = client.channels.find(value => row.recipient === `channel:${value.index}`);
          else contact = client.contacts.find(value => value.type === 1 && row.recipient === `contact:${value.publicKey}`);
          if (channel ? !targetChannel : !contact) throw Object.assign(new Error('The destination is no longer in the node’s configured list.'), { permanent: true });
          if (!channel && client.contacts.filter(value => value.publicKey.startsWith(contact.publicKey.slice(0, 12))).length !== 1) throw Object.assign(new Error('Two contacts share the destination identity prefix. Resolve the duplicate before sending.'), { permanent: true });
          if (!channel) {
            if (!row.delivery.floodFallback && row.delivery.attempts.filter(value => value.state === 'no-ack').length >= 2 && (contact.pathLength & 255) !== 255) {
              await client.request(() => client.proto.sendCommandResetPath(Buffer.from(contact.publicKey, 'hex')), [R.Ok]);
              contact.pathLength = -1; contact.outPath = []; row.delivery.floodFallback = true;
              attempt.routeRecovery = 'Flood discovery after two unacknowledged attempts';
            }
            try {
              const latest = await client.request(() => client.proto.sendToRadioFrame(Buffer.concat([Buffer.from([30]), Buffer.from(contact.publicKey, 'hex')])), [R.Contact]);
              if (Buffer.from(latest.publicKey || []).toString('hex') === contact.publicKey) { contact.pathLength = latest.outPathLen; contact.outPath = Array.from(latest.outPath || []); }
            } catch (error) { if (error.nodeCode !== 1) throw error; }
          }
          if (!this.current(row, generation, cycle)) { skipped = true; if (cycle === this.cycle) { attempt.state = 'cancelled'; this.changed(row); } return; }
          attempt.route = channel ? { kind: 'flood', source: 'channel-broadcast', capturedAt: Date.now(), hops: null, hashes: [], nodes: [] }
            : pathSnapshot(contact, client.contacts);
          attempt.wireTimestamp = row.timestamp;
          attempt.transmittedAt = Date.now();
          if (channel) client.observations?.trackOutgoing(row, attempt, targetChannel.index);
          return client.request(() => channel ? client.proto.sendCommandSendChannelTxtMsg(0, targetChannel.index, attempt.wireTimestamp, row.text)
            : client.proto.sendCommandSendTxtMsg(0, index, row.timestamp, Buffer.from(contact.publicKey, 'hex'), row.text), channel ? [R.Ok, R.Sent] : [R.Sent]);
        }, generation);
        if (skipped || cycle !== this.cycle || generation !== client.generation) return;
        attempt.acceptedAt = Date.now();
        if (channel) {
          attempt.state = 'accepted'; row.status = 'broadcast-sent'; row.delivery.nextAttemptAt = null;
          this.changed(row); return;
        }
        if (!channel) {
          attempt.ackCode = result.expectedAckCrc;
          attempt.estimatedTimeout = Number(result.estTimeout) || 30000;
          attempt.mode = result.result === 1 ? 'flood' : 'direct';
          if (attempt.mode === 'flood' && attempt.route.kind !== 'flood') attempt.route = { kind: 'flood', source: 'companion-send-result', capturedAt: Date.now(), hops: null, hashes: [], nodes: [] };
          // If the companion selected a direct route we did not have in its
          // last contact snapshot, its actual relay list remains unknown.
          if (attempt.mode === 'direct' && attempt.route.kind !== 'direct') attempt.route = { kind: 'unknown', source: 'companion-send-result', capturedAt: Date.now(), hops: null, hashes: [], nodes: [] };
          row.ack = result.expectedAckCrc;
        }
        if (row.status === 'delivered') {
          const contact = client.contacts.find(value => row.recipient === `contact:${value.publicKey}`);
          if (contact?.routeUpdatedAt) this.learnedRoute(contact.publicKey, contact, contact.routeUpdatedAt);
          this.changed(row); return;
        }
        attempt.state = 'awaiting-ack'; row.status = 'awaiting-ack';
        const wait = Math.max(10000, Math.min(180000, Math.ceil(attempt.estimatedTimeout * 1.25) + 2000));
        row.delivery.nextAttemptAt = Date.now() + wait; this.changed(row);
        await this.pause(wait);
        if (!this.current(row, generation, cycle)) return;
        attempt.state = 'no-ack'; row.status = 'retry-wait'; this.changed(row);
      } catch (error) {
        if (!this.current(row, generation, cycle)) return;
        attempt.state = 'rejected'; attempt.error = error.message; row.error = error.message;
        if (error.fatal) { this.changed(row); throw error; }
        // A channel has no recipient ACK. Retry only an explicit node rejection;
        // a lost/ambiguous local response might already have queued a broadcast.
        if (error.permanent || (channel ? !Number.isInteger(error.nodeCode) : error.nodeCode && ![3, 4].includes(error.nodeCode))) {
          row.status = row.delivery.attempts.some(value => value.acceptedAt) ? channel ? 'broadcast-sent' : 'unconfirmed' : 'failed';
          if (!channel) row.delivery.receipt = { kind: row.delivery.attempts.some(value => value.acceptedAt) ? 'unconfirmed' : 'not-sent' };
          row.delivery.nextAttemptAt = null; this.changed(row); return;
        }
        row.status = 'retry-wait'; row.delivery.nextAttemptAt = Date.now() + Math.min(10000, (index + 1) * 2000); this.changed(row);
        if (index + 1 < MESSAGE_ATTEMPTS) await this.pause(Math.min(10000, (index + 1) * 2000));
      }
    }
    if (!this.current(row, generation, cycle)) return;
    const accepted = row.delivery.attempts.some(attempt => attempt.acceptedAt);
    row.status = accepted ? channel ? 'broadcast-sent' : 'unconfirmed' : 'failed';
    row.delivery.nextAttemptAt = null;
    if (!channel) { row.delivery.receipt = { kind: accepted ? 'unconfirmed' : 'not-sent' }; row.error = accepted ? 'No recipient ACK after four attempts. Delivery is unconfirmed.' : 'The node did not accept a message transmission in four attempts.'; }
    this.changed(row);
  }
  confirm(data) {
    const client = this.client;
    const row = client.history.findLast(value => value.node === client.node?.publicKey && value.direction === 'out' && value.status !== 'delivered' &&
      (value.delivery?.type === 'direct' ? value.delivery.attempts.some(attempt => attempt.transmittedAt && attempt.ackCode === data.ackCode) : value.ack === data.ackCode));
    if (!row) return;
    row.status = 'delivered'; row.roundTrip = data.roundTrip; delete row.error;
    if (row.delivery) {
      const attempt = row.delivery.attempts.find(value => value.ackCode === data.ackCode);
      attempt.state = 'delivered'; row.delivery.nextAttemptAt = null;
      const observation = this.ackPaths.get(data.ackCode);
      row.delivery.receipt = { kind: 'confirmed', receivedAt: Date.now(), attempt: attempt.number, ackCode: data.ackCode, roundTripMs: data.roundTrip,
        ...(observation && Math.abs(Date.now() - observation.observedAt) < 15000 ? { ackReturnPath: observation } : {}) };
      const contact = client.contacts.find(value => row.recipient === `contact:${value.publicKey}`);
      if (attempt.mode === 'flood' && contact?.routeUpdatedAt && Math.abs(Date.now() - contact.routeUpdatedAt) < 3000) {
        row.delivery.receipt.learnedRoute = pathSnapshot(contact, client.contacts, 'contact-path-update');
        row.delivery.receipt.learnedRoute.observedAt = contact.routeUpdatedAt;
      }
      this.changed(row);
    } else { client.save(); client.publish(); }
    if (this.active === row) this.wake?.();
  }
  observeAck(data) {
    const observation = observedAckPath(data.raw, this.client.contacts);
    if (!observation) return;
    observation.snr = data.lastSnr; observation.rssi = data.lastRssi;
    for (const [key, value] of this.ackPaths) if (Date.now() - value.observedAt > 180000) this.ackPaths.delete(key);
    this.ackPaths.delete(observation.ackCode); this.ackPaths.set(observation.ackCode, observation);
    if (this.ackPaths.size > 256) this.ackPaths.delete(this.ackPaths.keys().next().value);
    const row = this.client.history.findLast(value => value.node === this.client.node?.publicKey && value.delivery?.receipt?.kind === 'confirmed' &&
      value.delivery.receipt.ackCode === observation.ackCode && Math.abs(value.delivery.receipt.receivedAt - observation.observedAt) < 15000 && !value.delivery.receipt.ackReturnPath);
    if (row) { row.delivery.receipt.ackReturnPath = observation; this.changed(row); }
  }
  learnedRoute(publicKey, contact, observedAt) {
    for (const row of this.client.history) {
      const receipt = row.delivery?.receipt;
      if (row.node !== this.client.node?.publicKey || row.recipient !== `contact:${publicKey}` || receipt?.kind !== 'confirmed' ||
        Math.abs(receipt.receivedAt - observedAt) > 3000 || receipt.learnedRoute) continue;
      const attempt = row.delivery.attempts.find(value => value.number === receipt.attempt);
      if (attempt?.mode === 'flood') { receipt.learnedRoute = pathSnapshot(contact, this.client.contacts, 'contact-path-update'); receipt.learnedRoute.observedAt = observedAt; this.changed(row); }
    }
  }
  stop() {
    ++this.cycle; this.wake?.(); clearTimeout(this.timer); this.timer = null;
    for (const row of [this.active, ...this.queue].filter(Boolean)) if (PENDING_DELIVERY_STATES.includes(row.status)) {
      row.status = 'interrupted'; row.error = 'The companion disconnected. Pending attempts were stopped and will not resume automatically.';
      row.delivery.nextAttemptAt = null; row.delivery.interrupted = true; row.delivery.revision++;
      if (row.delivery.type === 'direct') row.delivery.receipt = { kind: 'unconfirmed' };
    }
    this.queue = []; this.active = null; this.ackPaths.clear();
  }
}
