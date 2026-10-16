const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

export function relayMatches(hash, contacts = []) {
  return contacts.filter(row => row.type === 2 && row.publicKey.startsWith(hash)).slice(0, 8)
    .map(row => ({ name: row.name || row.publicKey.slice(0, 12), publicKey: row.publicKey }));
}

export function receivedHopInfo(encoded) {
  if (!Number.isInteger(encoded) || encoded < 0 || encoded > 255) return { kind: 'unknown', hops: null };
  if (encoded === 255) return { kind: 'routed', hops: null };
  const hashBytes = (encoded >> 6) + 1, hops = encoded & 63;
  return hashBytes > 3 || hashBytes * hops > 64 ? { kind: 'unknown', hops: null } : { kind: 'flood', hops, hashBytes };
}

export function receivedHopLabel(message) {
  const info = message.reception || receivedHopInfo(message.pathLength);
  if (!Number.isInteger(info.hops)) return info.kind === 'routed' ? 'Hops not reported · routed message' : 'Hop count not recorded';
  return info.hops === 0 ? '0 relay hops · direct reception' : `${info.hops} relay hop${info.hops === 1 ? '' : 's'}`;
}

export function heardRepeatersLabel(message) {
  const evidence = message.delivery?.rebroadcast;
  if (!evidence) return '';
  if (!evidence.available) return 'Repeater observations unavailable';
  const count = evidence.repeaterCount || 0, repeats = evidence.repeatCount || 0;
  return `Repeaters heard: ${evidence.countLimited ? 'at least ' : ''}${count} ID${count === 1 ? '' : 's'} · ${repeats} repeat${repeats === 1 ? '' : 's'}`;
}

export function meshPath(encoded, bytes = []) {
  if (!Number.isInteger(encoded)) return { kind: 'unknown', hops: null, hashes: [] };
  const value = encoded & 255;
  if (value === 255) return { kind: 'flood', hops: null, hashes: [] };
  const size = (value >> 6) + 1, count = value & 63;
  if (size > 3 || size * count > 64 || bytes.length < size * count) return { kind: 'unknown', hops: null, hashes: [] };
  return { kind: 'direct', hops: count, hashBytes: size,
    hashes: Array.from({ length: count }, (_, index) => hex(Array.from(bytes).slice(index * size, (index + 1) * size))) };
}

export function pathSnapshot(contact, contacts, source = 'send-route') {
  const route = meshPath(contact?.pathLength, contact?.outPath || []);
  return { ...route, source, capturedAt: Date.now(), nodes: route.hashes.map(hash => ({ hash,
    matches: contacts.filter(row => row.publicKey.startsWith(hash)).slice(0, 8).map(row => ({ name: row.name || row.publicKey.slice(0, 12), publicKey: row.publicKey })) })) };
}

// Parse only ACK metadata from the companion's RX log. A logged packet alone
// never confirms delivery; PUSH_CODE_SEND_CONFIRMED must also match its CRC.
export function observedAckPath(raw, contacts = []) {
  const bytes = Uint8Array.from(raw || []);
  if (bytes.length < 6 || bytes[0] >> 6 !== 0) return null;
  const routeType = bytes[0] & 3, type = (bytes[0] >> 2) & 15;
  if (type !== 3 && type !== 10) return null;
  let offset = routeType === 0 || routeType === 3 ? 5 : 1;
  if (offset >= bytes.length) return null;
  const encoded = bytes[offset++], route = meshPath(encoded, bytes.subarray(offset));
  if (route.kind !== 'direct') return null;
  offset += route.hops * route.hashBytes;
  if (type === 10) { if (offset >= bytes.length || (bytes[offset++] & 15) !== 3) return null; }
  if (offset + 4 > bytes.length) return null;
  const ackCode = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
  const flood = routeType === 0 || routeType === 1;
  return { ackCode, observedAt: Date.now(), source: 'ack-rx-log', kind: flood ? 'flood-return' : 'direct-return',
    // A routed ACK consumes its path as it travels. Its remaining path is not
    // the number of relays it traversed; never display zero as a measured count.
    hops: flood ? route.hops : null, hashBytes: route.hashBytes, hashes: flood ? route.hashes : [],
    nodes: flood ? route.hashes.map(hash => ({ hash, matches: contacts.filter(row => row.publicKey.startsWith(hash)).slice(0, 8).map(row => ({ name: row.name || row.publicKey.slice(0, 12), publicKey: row.publicKey })) })) : [] };
}

export function deliveryLabel(message) {
  const delivery = message.delivery;
  if (!delivery) return ({ sending: 'Sending…', 'sent-to-node': 'Sent to node · recipient receipt unavailable', 'awaiting-ack': 'Waiting for recipient ACK', delivered: 'Delivered · recipient ACK', unconfirmed: 'Delivery unconfirmed', failed: 'Rejected by node' })[message.status] || message.status;
  const count = delivery.attempts.length, limit = delivery.maxAttempts;
  if (message.status === 'delivered') return `Delivered · recipient ACK · attempt ${delivery.receipt?.attempt || count}/${limit}`;
  if (message.status === 'queued') return 'Queued';
  if (message.status === 'sending') return `Sending · attempt ${count}/${limit}`;
  if (message.status === 'awaiting-ack') return `Awaiting recipient ACK · attempt ${count}/${limit}`;
  if (message.status === 'retry-wait') return `Retry scheduled · ${count}/${limit} attempts`;
  if (message.status === 'broadcast-sent') return `Sent to node · ${delivery.attempts.filter(attempt => attempt.acceptedAt).length} broadcast${delivery.attempts.filter(attempt => attempt.acceptedAt).length === 1 ? '' : 's'} · recipient receipt unavailable`;
  if (message.status === 'interrupted') return `Stopped on disconnect · ${count}/${limit} attempts · delivery unconfirmed`;
  return `${message.status === 'failed' ? 'Send rejected' : 'Delivery unconfirmed'} · ${count}/${limit} attempts`;
}

export function deliveryHopLabel(message) {
  if (message.status !== 'delivered') return '';
  const delivery = message.delivery, receipt = delivery?.receipt;
  const attempt = delivery?.attempts.find(row => row.number === receipt?.attempt);
  if (attempt?.route?.kind === 'direct' && Number.isInteger(attempt.route.hops)) return `${attempt.route.hops} relay hops · outbound route snapshot`;
  if (receipt?.ackReturnPath?.kind === 'flood-return') return `${receipt.ackReturnPath.hops} relay hops · ACK return`;
  if (receipt?.learnedRoute?.kind === 'direct') return `${receipt.learnedRoute.hops} relay hops · learned route`;
  return 'Hop count not reported';
}
