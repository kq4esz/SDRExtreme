import { EventEmitter } from 'node:events';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Connection, Constants } from '@liamcottle/meshcore.js';
import { meshProfile, detectedMeshProfile, meshTransportName } from './meshcore-devices.mjs';
import { MESH_CATEGORIES, MAX_MESH_LAYOUT_ITEMS, normalizeMeshLayout, meshConversations, orderedMeshTargets } from './meshcore-conversations.mjs';
import { repeaterLoginFrame, repeaterStats } from './meshcore-repeater.mjs';
import { MeshDelivery, MESSAGE_ATTEMPTS, CHANNEL_TRANSMISSIONS, PENDING_DELIVERY_STATES } from './meshcore-delivery.mjs';

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
    this.layouts = Object.fromEntries(Object.entries(saved.layouts || {}).filter(([key]) => /^[a-f0-9]{64}$/.test(key)));
    for (const message of this.history) {
      if (PENDING_DELIVERY_STATES.includes(message.status)) {
        message.status = message.delivery ? 'interrupted' : 'unconfirmed';
        if (message.delivery) { message.delivery.interrupted = true; message.delivery.nextAttemptAt = null; message.delivery.revision++; if (message.delivery.type === 'direct') message.delivery.receipt = { kind: 'unconfirmed' }; message.error = 'App restarted. Pending attempts were stopped and will not resume automatically.'; }
      }
      // Older versions did not track reads; don't flag existing history as new.
      if (message.direction === 'in') message.unread = message.unread === true;
    }
    this.phase = 'disconnected'; this.error = ''; this.warning = ''; this.node = null;
    this.contacts = []; this.channels = []; this.sequence = Promise.resolve();
    this.generation = 0; this.cancelRequests = new Set(); this.delivery = new MeshDelivery(this);
    this.repeaters = {}; this.repeaterOperation = null;
  }

  snapshot() {
    return { phase: this.phase, error: this.error, warning: this.warning, config: this.config,
      connectionId: this.connectionId || null, node: this.node, contacts: this.contacts, channels: this.channels,
      messages: this.history.filter(row => row.node === this.node?.publicKey),
      layout: normalizeMeshLayout(this.layouts[this.node?.publicKey]),
      repeaters: this.repeaters, repeaterBusy: this.repeaterOperation ? { id: this.repeaterOperation.id, publicKey: this.repeaterOperation.publicKey, action: this.repeaterOperation.action } : null,
      deliveryPolicy: { maxAttempts: MESSAGE_ATTEMPTS, channelTransmissions: CHANNEL_TRANSMISSIONS },
      connected: this.phase === 'connected', refreshing: Boolean(this.refreshing), maxTextBytes: 150 };
  }
  publish() { this.emit('state', this.snapshot()); }
  save() {
    this.history = this.history.slice(-MAX_HISTORY);
    try {
      // Node channel keys and identity keys are never stored or sent to the UI.
      fs.writeFileSync(this.file + '.tmp', JSON.stringify({ config: this.config, messages: this.history, layouts: this.layouts }, null, 2));
      fs.renameSync(this.file + '.tmp', this.file);
      return true;
    } catch { this.warning = 'MeshCore data could not be saved. Check the saved data folder.'; return false; }
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
      if ([P.LoginSuccess, P.LoginFail, P.StatusResponse].includes(frame[0])) {
        if (frame.length < 8) return; // A bad remote reply must not close the local companion link.
        if (frame[0] === P.LoginSuccess) this.proto.emit(P.LoginSuccess, repeaterLoginFrame(frame));
        else this.proto.emit(frame[0], { pubKeyPrefix: frame.subarray(2, 8), statusData: frame.subarray(8) });
        return;
      }
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
    on(P.SendConfirmed, data => this.delivery.confirm(data));
    on(P.LogRxData, data => this.delivery.observeAck(data));
    on(P.NewAdvert, data => { this.warning = `Discovered ${clean(data.advName) || 'a node'}. Add new contacts with your existing MeshCore companion app, then refresh.`; this.publish(); });
    const refreshContacts = () => {
      if (this.phase !== 'connected' || this.contactTimer) return;
      this.contactTimer = setTimeout(() => { this.contactTimer = null; this.refresh().catch(() => {}); }, 1200);
    };
    on(P.Advert, refreshContacts);
    on(P.PathUpdated, data => {
      if (this.phase !== 'connected') return;
      const key = Buffer.from(data.publicKey), publicKey = hex(key), observedAt = Date.now();
      // Login learns a route. Fetch just that contact instead of a full channel
      // sync, which could delay draining a subsequent command reply.
      this.enqueue(async () => {
        const row = await this.request(() => this.proto.sendToRadioFrame(Buffer.concat([Buffer.from([30]), key])), [R.Contact]);
        const contact = this.contacts.find(value => value.publicKey === publicKey);
        if (contact && hex(row.publicKey) === publicKey) {
          contact.pathLength = row.outPathLen; contact.outPath = Array.from(row.outPath || []); contact.lastAdvert = row.lastAdvert; contact.routeUpdatedAt = observedAt;
          this.delivery.learnedRoute(publicKey, contact, observedAt); this.publish();
        }
      }, generation).catch(error => { if (error.fatal) this.fail(error, generation); });
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
        pathLength: data.outPathLen, outPath: Array.from(data.outPath || []), lastAdvert: data.lastAdvert });
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
    if (!channel && (data.txtType === Constants.TxtTypes.CliData || (matches.length === 1 && matches[0].type === 2))) {
      // Remote consoles can echo changed passwords or other private settings.
      // Keep their command/reply history in RAM, outside saved chat history.
      if (matches.length === 1 && matches[0].type === 2) {
        const state = this.repeaterState(matches[0].publicKey);
        const dedupe = `${data.senderTimestamp}:${text}`;
        if (!state.events.some(event => event.dedupe === dedupe)) this.repeaterEvent(state, 'in', text, { dedupe, snr: data.snr });
      }
      return;
    }
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

  organize(input) {
    if (!input || !this.node || input.node !== this.node.publicKey) throw new Error('The MeshCore node changed. Open its list again.');
    const node = input.node, previous = this.layouts[node];
    const conversations = meshConversations({ channels: this.channels, contacts: this.contacts, messages: this.history.filter(message => message.node === node) });
    const layout = normalizeMeshLayout(previous, conversations.resolveId);
    if (input.action === 'tabs') {
      if (!Array.isArray(input.order) || input.order.length !== 2 || new Set(input.order).size !== 2 || !input.order.every(category => MESH_CATEGORIES.includes(category))) throw new Error('Choose a valid Channels / Contacts tab order.');
      layout.tabOrder = [...input.order];
    } else {
      const category = input.category;
      if (!MESH_CATEGORIES.includes(category)) throw new Error('Choose Channels or Contacts.');
      const rows = orderedMeshTargets(conversations.targets, layout, category);
      const id = typeof input.id === 'string' ? conversations.resolveId(input.id) : '';
      const row = rows.find(target => target.id === id);
      if (!row) throw new Error('That conversation is no longer in this node’s list.');
      const preferences = layout[category];
      if (input.action === 'favorite' || input.action === 'pin') {
        if (typeof input.enabled !== 'boolean') throw new Error('Choose whether this option is enabled.');
        const field = input.action === 'pin' ? 'pinned' : 'favorites';
        preferences[field] = preferences[field].filter(value => value !== id);
        if (input.enabled) preferences[field].unshift(id);
        if (input.action === 'pin' && input.enabled) preferences.order = [id, ...rows.map(target => target.id).filter(value => value !== id), ...preferences.order.filter(value => !rows.some(target => target.id === value))];
      } else if (input.action === 'move') {
        const targetId = typeof input.target === 'string' ? conversations.resolveId(input.target) : '';
        const target = rows.find(value => value.id === targetId);
        if (!target || typeof input.before !== 'boolean') throw new Error('Drop onto another conversation in the same category.');
        if (id === targetId) return { node, layout };
        const order = rows.map(value => value.id).filter(value => value !== id);
        order.splice(order.indexOf(targetId) + (input.before ? 0 : 1), 0, id);
        preferences.order = [...order, ...preferences.order.filter(value => !rows.some(target => target.id === value))];
        // Moving into or out of the Pinned group follows the visible drop target.
        preferences.pinned = preferences.pinned.filter(value => value !== id);
        if (target.pinned) preferences.pinned.push(id);
      } else throw new Error('Unsupported conversation list action.');
      for (const field of ['order', 'pinned', 'favorites']) if (preferences[field].length > MAX_MESH_LAYOUT_ITEMS) throw new Error('This node has reached its saved conversation layout limit.');
    }
    layout.revision++;
    this.layouts[node] = layout;
    if (!this.save()) {
      if (previous === undefined) delete this.layouts[node]; else this.layouts[node] = previous;
      this.publish(); throw new Error('The list layout could not be saved. Check the saved data folder.');
    }
    this.publish(); return { node, layout };
  }

  repeaterState(publicKey) {
    return this.repeaters[publicKey] ||= { revision: 0, phase: 'idle', admin: null, permissions: null, events: [], error: '', notice: '', stats: null };
  }
  repeaterEvent(state, direction, text, extra = {}) {
    state.events.push({ id: randomUUID(), direction, text, timestamp: Math.floor(Date.now() / 1000), ...extra });
    state.events = state.events.slice(-100); state.revision++; this.publish();
  }
  repeaterContact(input) {
    if (this.phase !== 'connected' || !this.node || input?.node !== this.node.publicKey) throw new Error('Connect your companion node and select a repeater from its Contacts.');
    const contact = this.contacts.find(row => row.type === 2 && row.publicKey === input.publicKey);
    if (!contact) throw new Error('Select a repeater from this node’s current contact list.');
    if (this.contacts.filter(row => row.publicKey.startsWith(contact.publicKey.slice(0, 12))).length !== 1) throw new Error('This repeater shares its six-byte identity prefix with another contact. Resolve the duplicate identity before logging in.');
    return contact;
  }

  async repeaterRequest(contact, action, send, generation) {
    const proto = this.proto, prefix = contact.publicKey.slice(0, 12), listeners = [];
    let settled = false, active = false, timer, resolveReply, rejectReply;
    const reply = new Promise((resolve, reject) => { resolveReply = resolve; rejectReply = reject; });
    // The response can fail while we are still awaiting the companion's SENT frame.
    void reply.catch(() => {});
    const cleanup = () => { clearTimeout(timer); this.cancelRequests.delete(cancel); for (const [code, handler] of listeners) proto.off(code, handler); };
    const finish = (error, value) => { if (settled) return; settled = true; cleanup(); error ? rejectReply(error) : resolveReply(value); };
    const cancel = () => finish(new Error('The companion connection ended. Log in again after reconnecting.'));
    const listen = (code, handler) => { const filtered = data => { if (active && hex(data.pubKeyPrefix) === prefix) handler(data); }; proto.on(code, filtered); listeners.push([code, filtered]); };
    const timedOut = () => finish(new Error(action === 'login'
      ? 'No login reply from the repeater. Check its password, radio range and route. An incorrect password may receive no reply.'
      : action === 'command' ? 'No command reply received. The command may have executed; check before sending it again.' : 'No status reply from the repeater. Its session, radio range or route may have changed.'));
    if (action === 'login') {
      listen(P.LoginSuccess, data => finish(null, data));
      listen(P.LoginFail, () => finish(new Error('The repeater rejected this login. Check its password and access permissions.')));
    } else if (action === 'status') listen(P.StatusResponse, data => finish(null, data));
    else listen(R.ContactMsgRecv, data => finish(null, data));
    this.cancelRequests.add(cancel);
    try {
      await this.enqueue(async () => {
        if (settled) throw new Error('The repeater request was cancelled.');
        // Drain earlier CLI responses before sending the next command. Waiting
        // for its new RF reply happens outside the companion command queue so
        // SYNC_NEXT_MESSAGE remains available to receive that reply.
        if (action === 'command') await this.drainMessages(generation);
        active = true; timer = setTimeout(timedOut, 15000);
        const sent = await this.request(send, [R.Sent]);
        if (!settled) { clearTimeout(timer); timer = setTimeout(timedOut, Math.max(8000, Math.min(120000, (Number(sent.estTimeout) || 10000) + 5000))); }
      }, generation);
      return await reply;
    } catch (error) { finish(error); throw error; }
    finally { cleanup(); }
  }

  async repeaterAction(input) {
    const contact = this.repeaterContact(input), action = input.action;
    if (!['login', 'logout', 'status', 'command'].includes(action)) throw new Error('Choose a repeater login, logout, status or command action.');
    if (this.repeaterOperation) throw new Error('Wait for the current repeater request to finish.');
    const state = this.repeaterState(contact.publicKey);
    if (['status', 'command'].includes(action) && state.phase !== 'authenticated') throw new Error('Log in to this repeater first.');
    if (action === 'command' && state.admin === false) throw new Error('This repeater login does not have administrator access. Log in with its admin password to send commands.');
    const password = typeof input.password === 'string' ? input.password : '';
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    if (action === 'login' && (typeof input.password !== 'string' || Buffer.byteLength(password) > 15 || /[\x00-\x1f\x7f]/.test(password))) throw new Error('Use a repeater password of up to 15 UTF-8 bytes, or leave it blank for an existing ACL entry.');
    if (action === 'command' && (!command || Buffer.byteLength(command) > 150 || /[\x00-\x1f\x7f]/.test(command))) throw new Error('Enter a single command of 1–150 UTF-8 bytes.');
    const generation = this.generation, node = this.node.publicKey, connectionId = this.connectionId, proto = this.proto;
    const operation = { id: randomUUID(), publicKey: contact.publicKey, action }; this.repeaterOperation = operation;
    state.error = ''; state.notice = action === 'login' ? 'Waiting for the repeater to confirm login…' : action === 'status' ? 'Requesting repeater status…' : action === 'logout' ? 'Ending this app session…' : 'Waiting for a repeater command reply…';
    if (action === 'login') { state.phase = 'logging-in'; state.admin = null; state.permissions = null; state.stats = null; }
    state.revision++; this.publish();
    try {
      const key = Buffer.from(contact.publicKey, 'hex');
      if (action === 'logout') {
        // CMD_LOGOUT stops companion-managed connections. It does not remove
        // the companion's persistent authorization from the repeater ACL.
        await this.enqueue(() => this.request(() => proto.sendToRadioFrame(Buffer.concat([Buffer.from([29]), key])), [R.Ok]), generation);
        state.phase = 'idle'; state.admin = null; state.permissions = null; state.stats = null; state.events = [];
        state.notice = 'App session ended. Log in again to use this repeater.';
      } else {
        if (action === 'command') this.repeaterEvent(state, 'out', /^(?:password\s|set\s+guest\.password\s)/i.test(command) ? '[Password change command]' : command);
        const response = await this.repeaterRequest(contact, action, () => action === 'login' ? proto.sendCommandSendLogin(key, password)
          : action === 'status' ? proto.sendCommandSendStatusReq(key) : proto.sendCommandSendTxtMsg(Constants.TxtTypes.CliData, 0, Math.floor(Date.now() / 1000), key, command), generation);
        this.assertCurrent(generation);
        if (action === 'login') {
          state.phase = 'authenticated'; state.admin = response.admin; state.permissions = response.permissions; state.firmwareLevel = response.firmwareLevel; state.loginAt = Date.now();
          state.notice = state.admin === true ? 'Logged in · administrator access' : state.admin === false ? 'Logged in · guest access (status only)' : 'Logged in · legacy repeater; access level not reported';
        } else if (action === 'status') { state.stats = { ...repeaterStats(response.statusData), updatedAt: Date.now() }; state.notice = 'Status received from the repeater.'; }
        else state.notice = 'Command reply received from the repeater.';
      }
      state.revision++;
    } catch (error) {
      if (generation === this.generation) {
        if (action === 'login') state.phase = 'error';
        state.error = clean(error.message, 350); state.notice = ''; state.revision++;
        if (error.fatal) this.fail(error, generation);
      }
      throw error;
    } finally {
      if (this.repeaterOperation === operation) this.repeaterOperation = null;
      if (generation === this.generation) this.publish();
    }
    return { node, connectionId, operationId: operation.id, publicKey: contact.publicKey, repeater: state };
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
    this.delivery.add({ recipient, text, channel: Boolean(channel) });
    return this.snapshot();
  }

  fail(error, generation = this.generation) {
    if (generation !== this.generation || !this.proto) return;
    this.disconnect(); this.phase = 'error'; this.error = clean(error.message, 300); this.publish();
  }
  disconnect() {
    ++this.generation;
    for (const cancel of [...this.cancelRequests]) cancel();
    this.delivery.stop();
    this.repeaters = {}; this.repeaterOperation = null;
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
