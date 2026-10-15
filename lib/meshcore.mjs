import { EventEmitter } from 'node:events';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Connection, Constants } from '@liamcottle/meshcore.js';
import { meshProfile, detectedMeshProfile, meshTransportName } from './meshcore-devices.mjs';

export const meshcoreCatalog = JSON.parse(fs.readFileSync(new URL('./meshcore-devices.json', import.meta.url), 'utf8'));

const R = Constants.ResponseCodes, P = Constants.PushCodes;
const hex = value => Buffer.from(value || []).toString('hex');
const clean = (value, max = 160) => String(value || '').replace(/\0/g, '').slice(0, max);
const MAX_HISTORY = 1500;
const ERRORS = { 1: 'Command unsupported by this firmware', 2: 'Entry not found on the node', 3: 'The node queue or table is full', 4: 'The node is busy', 5: 'Node storage error', 6: 'The node rejected the command arguments' };

// Keep the official command encoder/parser, with synchronous response dispatch so
// a late SDK timer cannot satisfy a command belonging to another connection.
class Companion extends Connection {
  constructor(write) { super(); this.write = write; }
  async sendToRadioFrame(data) { await this.write(Buffer.from(data)); }
  emit(code, value) { for (const callback of [...(this.eventListenersMap.get(code) || [])]) callback(value); }
}

export class MeshCoreClient extends EventEmitter {
  constructor(dataDir) {
    super();
    this.file = path.join(dataDir, 'meshcore.json');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.config = { transport: 'usb', modelId: 'auto', host: '', port: 5000, path: '', ...saved.config };
    this.history = (Array.isArray(saved.messages) ? saved.messages : []).slice(-MAX_HISTORY);
    for (const message of this.history) {
      if (['sending', 'awaiting-ack'].includes(message.status)) message.status = 'unconfirmed';
      // Older versions did not track reads; don't flag existing history as new.
      if (message.direction === 'in') message.unread = message.unread === true;
    }
    this.phase = 'disconnected'; this.error = ''; this.warning = ''; this.node = null;
    this.contacts = []; this.channels = []; this.sequence = Promise.resolve();
    this.generation = 0; this.cancelRequests = new Set(); this.ackTimers = new Map();
  }

  snapshot() {
    return { phase: this.phase, error: this.error, warning: this.warning, config: this.config,
      connectionId: this.connectionId || null, node: this.node, contacts: this.contacts, channels: this.channels,
      messages: this.history.filter(row => row.node === this.node?.publicKey),
      connected: this.phase === 'connected', refreshing: Boolean(this.refreshing), maxTextBytes: 150 };
  }
  publish() { this.emit('state', this.snapshot()); }
  save() {
    this.history = this.history.slice(-MAX_HISTORY);
    try {
      // Node channel keys and identity keys are never stored or sent to the UI.
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ config: this.config, messages: this.history }, null, 2));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch { this.warning = 'Message history could not be saved. Check the saved data folder.'; }
  }

  async ports() {
    const { SerialPort } = await import('serialport');
    return (await SerialPort.list()).map(port => ({ path: port.path, manufacturer: clean(port.manufacturer),
      friendlyName: clean(port.friendlyName), serialNumber: clean(port.serialNumber), vendorId: port.vendorId, productId: port.productId }));
  }

  connect(input) {
    if (!['wifi', 'usb', 'bluetooth'].includes(input.transport)) throw new Error('Choose USB, Wi-Fi, or Bluetooth.');
    const profile = meshProfile(meshcoreCatalog, input.modelId || 'auto');
    if (!profile) throw new Error('Select a node model, or choose Auto / other compatible node.');
    if (!profile.transports.includes(input.transport)) throw new Error(`${profile.name} has no ${meshTransportName(input.transport)} companion interface in the device catalog. Choose ${profile.transports.map(meshTransportName).join(' or ')}. For a custom build, choose Auto / other compatible node.`);
    if (this.phase !== 'disconnected' && this.phase !== 'error') throw new Error('Disconnect the current MeshCore session first.');
    const config = { transport: input.transport, modelId: profile.id, host: this.config.host, port: this.config.port, path: this.config.path };
    if (input.transport === 'wifi') {
      config.host = String(input.host || '').trim(); config.port = Number(input.port || 5000);
      if (!(net.isIP(config.host) || /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.\-]*[a-z0-9])?$/i.test(config.host))) throw new Error('Enter a node IP address or hostname without http://.');
      if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Enter a TCP port from 1 to 65535.');
    }
    if (input.transport === 'usb') {
      config.path = String(input.path || '');
      if (!/^COM\d+$/i.test(config.path)) throw new Error('Select the node’s USB COM port.');
    }
    this.config = config; this.phase = 'connecting'; this.error = ''; this.warning = '';
    this.contacts = []; this.channels = []; this.node = null; this.readBuffer = Buffer.alloc(0);
    this.connectionId = randomUUID(); const generation = ++this.generation;
    this.proto = new Companion(bytes => this.write(bytes, generation));
    this.attachEvents(generation); this.save(); this.publish();
    if (config.transport === 'bluetooth') {
      this.lastHeartbeat = Date.now();
      this.heartbeatTimer = setInterval(() => {
        if (Date.now() - this.lastHeartbeat > 35000) this.fail(new Error('The Bluetooth client closed. Connect again to resume.'), generation);
      }, 10000);
      this.heartbeatTimer.unref();
    } else {
      this.enqueue(async () => { await this.openTransport(generation); await this.initialize(generation); }, generation)
        .catch(error => this.fail(error, generation));
    }
    return { ...this.snapshot(), session: this.connectionId };
  }

  startBle(session) {
    this.checkBle(session);
    if (this.bleStarted) throw new Error('Bluetooth initialization is already running.');
    this.bleStarted = true; const generation = this.generation;
    this.enqueue(() => this.initialize(generation), generation).catch(error => this.fail(error, generation));
    return { started: true };
  }
  checkBle(session) {
    if (!session || session !== this.connectionId || this.config.transport !== 'bluetooth' || !this.proto) throw new Error('This Bluetooth session has ended.');
    this.lastHeartbeat = Date.now();
  }
  receiveBle(session, encoded) {
    this.checkBle(session);
    if (typeof encoded !== 'string' || encoded.length > 1400 || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) throw new Error('Invalid Bluetooth frame.');
    this.receiveFrame(Buffer.from(encoded, 'base64'), this.generation);
  }

  async openTransport(generation) {
    if (this.config.transport === 'wifi') {
      const socket = net.createConnection({ host: this.config.host, port: this.config.port });
      this.transport = socket; socket.setNoDelay(true);
      socket.on('data', bytes => this.receiveSerial(bytes, generation));
      socket.on('error', error => this.fail(error, generation));
      socket.on('close', () => this.fail(new Error('The Wi-Fi node disconnected. Check its power and network, then reconnect.'), generation));
      await this.waitOpen(socket, 'connect', generation);
    } else {
      const { SerialPort } = await import('serialport');
      this.assertCurrent(generation);
      const ports = await SerialPort.list();
      this.assertCurrent(generation);
      if (!ports.some(port => port.path.toUpperCase() === this.config.path.toUpperCase())) throw new Error('That COM port is no longer available. Refresh the USB port list.');
      const port = new SerialPort({ path: this.config.path, baudRate: 115200, autoOpen: false });
      this.transport = port;
      port.on('data', bytes => this.receiveSerial(bytes, generation));
      port.on('error', error => this.fail(error, generation));
      port.on('close', () => this.fail(new Error('The USB node disconnected. Reconnect its cable and try again.'), generation));
      const opened = this.waitOpen(port, 'open', generation);
      port.open(error => { if (error) this.fail(error, generation); else if (generation !== this.generation && port.isOpen) port.close(() => {}); });
      await opened;
    }
  }

  waitOpen(transport, event, generation) {
    return new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer); this.cancelRequests.delete(cancel); transport.off(event, opened); transport.off('error', finish);
        error ? reject(error) : resolve();
      };
      const opened = () => { try { this.assertCurrent(generation); finish(); } catch (error) { finish(error); } };
      const cancel = () => finish(new Error('Connection cancelled.'));
      const timer = setTimeout(() => { finish(new Error('Connection timed out. Check the node address, firmware transport, and connection.')); }, 10000);
      this.cancelRequests.add(cancel); transport.once(event, opened); transport.once('error', finish);
    });
  }

  assertCurrent(generation) { if (generation !== this.generation || !this.proto) throw new Error('MeshCore connection ended.'); }
  enqueue(task, generation = this.generation) {
    if ((this.queued || 0) >= 32) return Promise.reject(new Error('Wait for the current MeshCore operation to finish.'));
    this.queued = (this.queued || 0) + 1;
    const result = this.sequence.then(() => { this.assertCurrent(generation); return task(); });
    this.sequence = result.catch(() => {}).finally(() => { this.queued--; });
    return result;
  }

  request(send, codes, { timeout = 6500, collect = null } = {}) {
    const proto = this.proto;
    return new Promise((resolve, reject) => {
      const listeners = [];
      const finish = (error, value) => {
        clearTimeout(timer); this.cancelRequests.delete(cancel);
        for (const [code, listener] of listeners) proto.off(code, listener);
        error ? reject(error) : resolve(value);
      };
      const listen = (code, handler) => { proto.on(code, handler); listeners.push([code, handler]); };
      for (const code of codes) listen(code, value => finish(null, { code, ...value }));
      listen(R.Err, ({ errCode }) => finish(Object.assign(new Error(ERRORS[errCode] || `Node error ${errCode ?? 'unknown'}`), { nodeCode: errCode })));
      listen(R.Disabled, () => finish(new Error('Companion access is disabled on this node.')));
      if (collect) listen(R.Contact, collect);
      const cancel = () => finish(new Error('MeshCore connection ended.'));
      const timer = setTimeout(() => finish(Object.assign(new Error('The node did not answer. Reconnect and confirm it is running MeshCore companion firmware.'), { fatal: true })), timeout);
      this.cancelRequests.add(cancel);
      Promise.resolve().then(send).catch(error => finish(Object.assign(error, { fatal: true })));
    });
  }

  async write(bytes, generation) {
    this.assertCurrent(generation);
    if (this.config.transport === 'bluetooth') {
      this.emit('ble-frame', { session: this.connectionId, frame: bytes.toString('base64') }); return;
    }
    const frame = Buffer.alloc(3 + bytes.length); frame[0] = 0x3c; frame.writeUInt16LE(bytes.length, 1); bytes.copy(frame, 3);
    await new Promise((resolve, reject) => this.transport.write(frame, error => error ? reject(error) : resolve()));
  }

  receiveSerial(bytes, generation) {
    if (generation !== this.generation) return;
    if (this.readBuffer.length + bytes.length > 65536) { this.fail(new Error('Invalid companion serial stream. Confirm the node firmware and 115200 baud USB connection.'), generation); return; }
    this.readBuffer = Buffer.concat([this.readBuffer, bytes]);
    while (this.readBuffer.length >= 3) {
      if (this.readBuffer[0] !== 0x3e) { this.readBuffer = this.readBuffer.subarray(1); continue; }
      const length = this.readBuffer.readUInt16LE(1);
      if (!length || length > 1024) { this.readBuffer = this.readBuffer.subarray(1); continue; }
      if (this.readBuffer.length < length + 3) break;
      const frame = this.readBuffer.subarray(3, length + 3); this.readBuffer = this.readBuffer.subarray(length + 3);
      this.receiveFrame(frame, generation);
    }
  }
  receiveFrame(frame, generation) {
    if (generation !== this.generation || !this.proto || !frame.length || frame.length > 1024) return;
    try {
      // Channel key sizes vary by protocol version. Only the index and name are needed.
      if (frame[0] === R.DeviceInfo && frame.length >= 20) {
        // Bytes 4–7 contain the BLE PIN on modern firmware. Do not parse,
        // retain, log, or forward that field through the generic SDK response.
        const string = (start, end) => frame.subarray(start, end).toString('utf8').split('\0')[0];
        this.proto.emit(R.DeviceInfo, { firmwareVer: frame[1], maxChannels: frame[3],
          firmware_build_date: string(8, 20), manufacturerModel: string(20, 60), firmwareVersion: string(60, 80) });
      }
      else if (frame[0] === R.ChannelInfo && frame.length >= 50) this.proto.emit(R.ChannelInfo, { channelIdx: frame[1], name: frame.subarray(2, 34).toString('utf8').split('\0')[0] });
      else this.proto.onFrameReceived(new Uint8Array(frame));
    } catch { this.fail(new Error('Malformed MeshCore response. Confirm the node is running supported companion firmware.'), generation); }
  }

  attachEvents(generation) {
    const on = (code, handler) => this.proto.on(code, value => { if (generation === this.generation) handler(value); });
    on(P.MsgWaiting, () => { if (this.phase === 'connected') this.scheduleMessages(); else this.messagesWaiting = true; });
    on(R.ContactMsgRecv, data => this.received(data, false));
    on(R.ChannelMsgRecv, data => this.received(data, true));
    on(R.ChannelDataRecv, () => { this.warning = 'A binary channel packet was received; this client displays text messages.'; });
    on(P.SendConfirmed, data => {
      const row = this.history.findLast(message => message.node === this.node?.publicKey && message.ack === data.ackCode && message.status === 'awaiting-ack');
      if (row) { row.status = 'delivered'; row.roundTrip = data.roundTrip; clearTimeout(this.ackTimers.get(row.id)); this.ackTimers.delete(row.id); this.save(); this.publish(); }
    });
    on(P.NewAdvert, data => { this.warning = `Discovered ${clean(data.advName) || 'a node'}. Add new contacts with your existing MeshCore companion app, then refresh.`; this.publish(); });
    on(P.Advert, () => {
      if (this.phase !== 'connected' || this.contactTimer) return;
      this.contactTimer = setTimeout(() => { this.contactTimer = null; this.refresh().catch(() => {}); }, 1200);
    });
  }

  async initialize(generation) {
    this.phase = 'syncing'; this.publish();
    const info = await this.request(() => this.proto.sendToRadioFrame(Buffer.concat([Buffer.from([1, 1, 0, 0, 0, 0, 0, 0]), Buffer.from('SDR Extreme')])), [R.SelfInfo]);
    this.assertCurrent(generation);
    this.node = { publicKey: hex(info.publicKey), name: clean(info.name, 64), frequency: info.radioFreq / 1000,
      bandwidth: info.radioBw / 1000, spreadingFactor: info.radioSf, codingRate: info.radioCr, txPower: info.txPower };
    const device = await this.request(() => this.proto.sendCommandDeviceQuery(3), [R.DeviceInfo]);
    this.node.protocol = device.firmwareVer; this.node.buildDate = clean(device.firmware_build_date, 32); this.node.model = clean(device.manufacturerModel, 80);
    this.node.firmwareVersion = clean(device.firmwareVersion, 24); this.node.maxChannels = device.maxChannels || 8;
    const recognized = detectedMeshProfile(meshcoreCatalog, this.node.model);
    this.node.detectedProfile = recognized ? { id: recognized.id, name: recognized.name, platform: recognized.platform, transports: recognized.transports } : null;
    if (recognized && this.config.modelId !== 'auto' && recognized.id !== this.config.modelId) this.warning = `The node identifies as ${recognized.name}. The selected model is only a setup guide; this session uses the node’s reported identity and companion protocol.`;
    await this.loadContacts(); await this.loadChannels(); await this.battery();
    await this.drainMessages(generation);
    this.assertCurrent(generation); this.phase = 'connected'; this.publish();
    if (this.messagesWaiting) { this.messagesWaiting = false; this.scheduleMessages(); }
    this.pollTimer = setInterval(() => this.scheduleMessages(), 15000); this.pollTimer.unref();
  }

  async loadContacts() {
    const contacts = [];
    await this.request(() => this.proto.sendCommandGetContacts(), [R.EndOfContacts], { timeout: 25000, collect: data => {
      if (contacts.length < 2000) contacts.push({ publicKey: hex(data.publicKey), name: clean(data.advName, 64), type: data.type,
        pathLength: data.outPathLen, lastAdvert: data.lastAdvert });
    } });
    this.contacts = contacts.sort((a, b) => a.name.localeCompare(b.name)); this.publish();
  }
  async loadChannels() {
    const channels = [];
    for (let index = 0; index < Math.min(64, this.node.maxChannels || 8); index++) {
      try {
        const row = await this.request(() => this.proto.sendCommandGetChannel(index), [R.ChannelInfo]);
        if (row.channelIdx !== index) throw Object.assign(new Error('The node returned an unexpected channel index.'), { fatal: true });
        if (row.name) channels.push({ index, name: clean(row.name, 64) });
      } catch (error) { if ([1, 2].includes(error.nodeCode)) break; throw error; }
    }
    this.channels = channels; this.publish();
  }
  async battery() {
    try { const row = await this.request(() => this.proto.sendCommandGetBatteryVoltage(), [R.BatteryVoltage]); this.node.batteryMillivolts = row.batteryMilliVolts; }
    catch (error) { if (error.nodeCode !== 1) throw error; }
  }
  async drainMessages(generation) {
    for (let count = 0; count < 100; count++) {
      this.assertCurrent(generation);
      const response = await this.request(() => this.proto.sendCommandSyncNextMessage(), [R.NoMoreMessages, R.ContactMsgRecv, R.ChannelMsgRecv, R.ChannelDataRecv]);
      if (response.code === R.NoMoreMessages) return;
    }
    this.messagesWaiting = true;
  }
  scheduleMessages() {
    if (this.draining || this.phase !== 'connected') return;
    this.draining = true; this.messagesWaiting = false; const generation = this.generation;
    this.enqueue(() => this.drainMessages(generation), generation).catch(error => this.fail(error, generation)).finally(() => {
      if (generation !== this.generation) return;
      this.draining = false;
      if (this.messagesWaiting) setTimeout(() => { if (generation === this.generation) this.scheduleMessages(); }, 100);
    });
  }
  async refresh() {
    if (this.phase !== 'connected') throw new Error('Connect a MeshCore node first.');
    if (this.refreshing) return this.snapshot();
    this.refreshing = true; this.publish(); const generation = this.generation;
    try { await this.enqueue(async () => { await this.loadContacts(); await this.loadChannels(); await this.battery(); }, generation); }
    catch (error) { if (error.fatal) this.fail(error, generation); throw error; }
    finally { if (generation === this.generation) { this.refreshing = false; this.publish(); } }
    return this.snapshot();
  }

  received(data, channel) {
    if (!this.node) return;
    const prefix = channel ? null : hex(data.pubKeyPrefix);
    const matches = this.contacts.filter(contact => contact.publicKey.startsWith(prefix));
    const recipient = channel ? `channel:${data.channelIdx}` : `contact:${matches.length === 1 ? matches[0].publicKey : prefix}`;
    const text = clean(data.text, 500);
    const id = `${this.node.publicKey}:${recipient}:${data.senderTimestamp}:${text}`;
    if (this.history.some(message => message.dedupe === id)) return;
    this.history.push({ id: randomUUID(), dedupe: id, node: this.node.publicKey, recipient, direction: 'in', text,
      sender: channel ? clean(text.split(': ')[0], 64) : (matches.length === 1 ? matches[0].name : prefix),
      timestamp: data.senderTimestamp, receivedAt: Date.now(), snr: data.snr, pathLength: data.pathLen,
      status: 'received', textType: data.txtType, unread: true });
    this.save(); this.publish();
  }

  markRead(input) {
    if (!input || !this.node || input.node !== this.node.publicKey) throw new Error('The MeshCore node changed. Open its conversation again.');
    if (!Array.isArray(input.ids) || input.ids.length > MAX_HISTORY || !input.ids.every(id => typeof id === 'string' && id.length <= 100)) throw new Error('Invalid message read request.');
    const requested = new Set(input.ids), ids = [];
    let changed = false;
    for (const message of this.history) {
      if (message.node !== input.node || message.direction !== 'in' || !requested.has(message.id)) continue;
      ids.push(message.id);
      if (message.unread) { message.unread = false; changed = true; }
    }
    // Acknowledge only the exact displayed IDs. An incoming message arriving
    // while the client submits this request must keep its unread state.
    if (changed) { this.save(); this.publish(); }
    return { node: input.node, ids };
  }

  async send(input) {
    if (this.phase !== 'connected') throw new Error('Connect a MeshCore node before sending.');
    const recipient = String(input.recipient || ''), text = String(input.text || '').trim();
    const channel = recipient.startsWith('channel:') ? this.channels.find(row => `channel:${row.index}` === recipient) : null;
    const contact = recipient.startsWith('contact:') ? this.contacts.find(row => `contact:${row.publicKey}` === recipient && row.type === 1) : null;
    if (!channel && !contact) throw new Error('Select a configured channel or a chat contact.');
    // Channel frames include the sender's name on air; reserve space for it.
    const max = channel ? Math.max(1, Math.min(150, 160 - Buffer.byteLength(this.node.name) - 2)) : 150;
    if (!text || text.includes('\0') || Buffer.byteLength(text) > max) throw new Error(`Enter a message of 1–${max} UTF-8 bytes.`);
    const generation = this.generation, proto = this.proto, node = this.node.publicKey;
    this.lastSendTimestamp = Math.max(Math.floor(Date.now() / 1000), (this.lastSendTimestamp || 0) + 1);
    const row = { id: randomUUID(), node, recipient, direction: 'out', text, timestamp: this.lastSendTimestamp, status: 'sending' };
    this.history.push(row); this.save(); this.publish();
    try {
      await this.enqueue(async () => {
        const result = await this.request(() => channel
          ? proto.sendCommandSendChannelTxtMsg(0, channel.index, row.timestamp, text)
          : proto.sendCommandSendTxtMsg(0, 0, row.timestamp, Buffer.from(contact.publicKey, 'hex'), text), channel ? [R.Ok, R.Sent] : [R.Sent]);
        row.status = channel ? 'sent-to-node' : 'awaiting-ack';
        if (!channel) {
          row.ack = result.expectedAckCrc;
          const timer = setTimeout(() => { this.ackTimers.delete(row.id); if (row.status === 'awaiting-ack') { row.status = 'unconfirmed'; this.save(); this.publish(); } }, Math.max(10000, Math.min(120000, Number(result.estTimeout) || 30000)));
          timer.unref(); this.ackTimers.set(row.id, timer);
        }
      }, generation);
    } catch (error) {
      row.status = error.nodeCode ? 'failed' : 'unconfirmed'; row.error = error.message;
      if (error.fatal) this.fail(error, generation);
      throw error;
    } finally { this.save(); this.publish(); }
    return this.snapshot();
  }

  fail(error, generation = this.generation) {
    if (generation !== this.generation || !this.proto) return;
    this.disconnect(); this.phase = 'error'; this.error = clean(error.message, 300); this.publish();
  }
  disconnect() {
    ++this.generation;
    for (const cancel of [...this.cancelRequests]) cancel();
    for (const timer of this.ackTimers.values()) clearTimeout(timer);
    this.ackTimers.clear();
    for (const message of this.history) if (['sending', 'awaiting-ack'].includes(message.status)) message.status = 'unconfirmed';
    clearInterval(this.pollTimer); clearInterval(this.heartbeatTimer); clearTimeout(this.contactTimer);
    const transport = this.transport; this.transport = null; this.proto = null;
    if (transport instanceof net.Socket) transport.destroy();
    else if (transport?.isOpen) transport.close(() => {});
    this.phase = 'disconnected'; this.error = ''; this.connectionId = null;
    this.bleStarted = false; this.draining = false; this.refreshing = false; this.messagesWaiting = false; this.contactTimer = null;
    this.save(); this.publish(); return this.snapshot();
  }
}
