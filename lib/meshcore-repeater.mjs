// MeshCore companion-v1.17.1 remote server frames and RepeaterStats layout.
// See docs/meshcore-repeaters.md for upstream protocol references.
export function repeaterLoginFrame(frame) {
  if (frame.length < 8) return null;
  return { pubKeyPrefix: frame.subarray(2, 8),
    // The legacy 8-byte "OK" response hard-codes this flag to zero.
    // It cannot distinguish an administrator from a guest.
    admin: frame.length >= 12 ? Boolean(frame[1] & 1) : null,
    serverTimestamp: frame.length >= 12 ? frame.readUInt32LE(8) : null,
    permissions: frame.length >= 13 ? frame[12] : null,
    firmwareLevel: frame.length >= 14 ? frame[13] : null };
}

export function repeaterStats(data) {
  const bytes = Buffer.from(data);
  if (bytes.length < 48) throw new Error('The repeater returned an incomplete status report.');
  return { batteryMillivolts: bytes.readUInt16LE(0), queueLength: bytes.readUInt16LE(2),
    noiseFloor: bytes.readInt16LE(4), rssi: bytes.readInt16LE(6),
    packetsReceived: bytes.readUInt32LE(8), packetsSent: bytes.readUInt32LE(12),
    txAirSeconds: bytes.readUInt32LE(16), uptimeSeconds: bytes.readUInt32LE(20),
    sentFlood: bytes.readUInt32LE(24), sentDirect: bytes.readUInt32LE(28),
    receivedFlood: bytes.readUInt32LE(32), receivedDirect: bytes.readUInt32LE(36),
    errorFlags: bytes.readUInt16LE(40), snr: bytes.readInt16LE(42) / 4,
    directDuplicates: bytes.readUInt16LE(44), floodDuplicates: bytes.readUInt16LE(46),
    rxAirSeconds: bytes.length >= 52 ? bytes.readUInt32LE(48) : null,
    receiveErrors: bytes.length >= 56 ? bytes.readUInt32LE(52) : null };
}
