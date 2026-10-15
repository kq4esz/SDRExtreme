import { meshProfile, meshConnectionHelp, meshTransportName } from './lib/meshcore-devices.mjs';

const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const $ = selector => document.querySelector(selector);
const bytes = text => new TextEncoder().encode(text).length;
const element = (tag, className, text) => { const item = document.createElement(tag); item.className = className; if (text !== undefined) item.textContent = text; return item; };
const TYPES = { 1: 'Companion', 2: 'Repeater', 3: 'Room server' };
const STATUS = { sending: 'Sending…', 'sent-to-node': 'Sent to node · channel messages have no delivery receipt', 'awaiting-ack': 'Waiting for delivery receipt', delivered: 'Delivered', unconfirmed: 'Delivery unconfirmed', failed: 'Rejected by node' };

export class MeshCoreUi {
  constructor({ api, toast, socketReady }) {
    this.api = api; this.toast = toast; this.socketReady = socketReady;
    this.data = { phase: 'disconnected', config: {}, contacts: [], channels: [], messages: [] };
    this.transport = 'usb'; this.attempt = 0; this.writeQueue = Promise.resolve(); this.readQueue = Promise.resolve(); this.selected = '';
    this.category = 'channels'; this.categorySelections = { channels: '', contacts: '' }; this.pendingReads = new Set();
    this.catalog = { devices: [], release: null }; this.profileId = 'auto';
    $('#page-meshcore').innerHTML = `
      <div class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span>OFF-GRID MESSAGING</div><h1>MeshCore<span class="heading-period">.</span></h1><p>Your mesh. One connected workspace.</p></div><div class="mesh-state" id="mesh-state" role="status"><i></i><span>Not connected</span></div></div>
      <section class="mesh-connect panel" aria-label="MeshCore connection">
        <div class="mesh-connect-heading"><div><div class="section-kicker">COMPANION LINK</div><h2>Connect your node</h2></div><div class="mesh-transports" role="group" aria-label="Connection method"><button type="button" data-mesh-transport="usb" aria-pressed="true">▣ <span>USB</span></button><button type="button" data-mesh-transport="bluetooth" aria-pressed="false">ᛒ <span>Bluetooth</span></button><button type="button" data-mesh-transport="wifi" aria-pressed="false">◔ <span>Wi-Fi</span></button></div></div>
        <div class="mesh-profile-row"><div class="mesh-profile-select"><label class="field-label" for="mesh-model">NODE MODEL</label><select id="mesh-model"><option value="auto">Auto / other compatible node</option></select></div><div class="mesh-profile-copy"><strong id="mesh-profile-capabilities">USB serial · Bluetooth LE · Wi-Fi / TCP</strong><p id="mesh-profile-note">Uses the standard companion protocol across supported node models.</p></div></div>
        <form id="mesh-connect-form"><div class="mesh-connection-row">
          <div id="mesh-usb-fields" class="mesh-transport-fields"><div class="mesh-port-field"><label class="field-label" for="mesh-port">USB SERIAL PORT</label><div class="field-with-action"><select id="mesh-port"><option value="">Select your node’s COM port</option></select><button type="button" id="mesh-ports-refresh" class="outline-button">Refresh ports</button></div></div><span class="mesh-baud">115200 baud <span>·</span> direct USB</span></div>
          <div id="mesh-wifi-fields" class="mesh-transport-fields hidden"><div class="mesh-host-field"><label class="field-label" for="mesh-host">NODE IP ADDRESS / HOSTNAME</label><input id="mesh-host" placeholder="e.g. 192.168.1.50 or meshcore.local" autocomplete="off" maxlength="253"></div><div class="mesh-tcp-field"><label class="field-label" for="mesh-tcp-port">TCP PORT</label><input id="mesh-tcp-port" type="number" min="1" max="65535" value="5000"></div></div>
          <div id="mesh-bluetooth-fields" class="mesh-transport-fields hidden"><div class="mesh-ble-symbol">ᛒ</div><div><strong>Find a nearby MeshCore node</strong><p>Choose your node and enter its pairing PIN when prompted.</p><label class="mesh-ble-discovery"><input type="checkbox" id="mesh-ble-all"> Show all Bluetooth devices for custom names or missing advertisements</label></div></div>
          <div class="mesh-connect-actions"><button type="button" id="mesh-disconnect" class="outline-button hidden">Disconnect</button><button type="submit" id="mesh-connect" class="primary-button">Connect node <span>→</span></button></div>
        </div></form>
        <p class="mesh-connection-help" id="mesh-connection-help">Choose your node model or use Auto. Select the connection enabled in its companion firmware.</p>
        <div id="mesh-error" class="mesh-notice error hidden" role="alert"></div><div id="mesh-warning" class="mesh-notice hidden" role="status"></div>
      </section>
      <section class="mesh-node panel" aria-label="Connected node information"><div class="mesh-node-identity"><div class="mesh-node-icon">⌘</div><div><div class="section-kicker">LOCAL NODE</div><strong id="mesh-node-name">MeshCore companion node</strong><small id="mesh-node-detail">Connect to read your node’s identity and radio settings.</small><small id="mesh-node-model"></small></div></div><dl><div><dt>FREQUENCY</dt><dd id="mesh-node-frequency">—</dd></div><div><dt>LoRa PROFILE</dt><dd id="mesh-node-radio">—</dd></div><div><dt>BATTERY</dt><dd id="mesh-node-battery">—</dd></div><div><dt>CONTACTS</dt><dd id="mesh-contact-count">—</dd></div></dl><button type="button" id="mesh-refresh" class="outline-button" disabled>Sync node</button></section>
      <div class="mesh-workspace panel"><aside class="mesh-conversations"><div class="mesh-list-heading"><h2>Conversations</h2><span id="mesh-conversation-count">0</span></div><div class="mesh-category-tabs" role="tablist" aria-label="Conversation category"><button type="button" role="tab" id="mesh-tab-channels" aria-selected="true" aria-controls="mesh-conversation-panel" data-mesh-category="channels"><span>Channels</span><span id="mesh-channels-unread" class="mesh-unread-badge hidden" aria-hidden="true">0</span></button><button type="button" role="tab" id="mesh-tab-contacts" aria-selected="false" aria-controls="mesh-conversation-panel" tabindex="-1" data-mesh-category="contacts"><span>Contacts</span><span id="mesh-contacts-unread" class="mesh-unread-badge hidden" aria-hidden="true">0</span></button></div><div id="mesh-conversation-panel" role="tabpanel" aria-labelledby="mesh-tab-channels"><label class="sr-only" id="mesh-search-label" for="mesh-search">Search channels</label><input id="mesh-search" type="search" placeholder="Search channels…"><div class="mesh-conversation-scroll" id="mesh-conversation-list"></div></div><p class="sr-only" id="mesh-unread-status" role="status" aria-atomic="true"></p></aside>
        <section class="mesh-chat" aria-label="MeshCore messages"><header class="mesh-chat-heading"><div class="mesh-chat-avatar" id="mesh-chat-avatar">⌁</div><div><h2 id="mesh-chat-title">Your next conversation starts here</h2><p id="mesh-chat-subtitle">Connect a node and select a channel or contact.</p></div><span class="mesh-chat-tag" id="mesh-chat-tag">MESHCORE</span></header><div id="mesh-messages" class="mesh-messages" role="log" aria-label="Conversation messages" aria-live="polite"></div><form id="mesh-message-form" class="mesh-composer"><label class="sr-only" for="mesh-message">Message text</label><textarea id="mesh-message" rows="2" placeholder="Select a channel or chat contact to write a message…" disabled></textarea><div class="mesh-composer-bottom"><span id="mesh-send-hint">Messages travel through your connected LoRa node.</span><span id="mesh-byte-count">0 / 150 bytes</span><button class="primary-button" id="mesh-send" type="submit" disabled>Send <span>↗</span></button></div></form></section>
      </div><p class="mesh-footer-note">MeshCore companion firmware is required. USB, BLE and Wi-Fi availability depends on your firmware build. Mesh messaging uses the node’s LoRa radio.</p>
      <dialog class="app-dialog mesh-dialog" id="mesh-device-dialog"><div class="dialog-head"><div><div class="section-kicker">BLUETOOTH LOW ENERGY</div><h2>Choose a MeshCore node</h2></div><button type="button" class="icon-button" id="mesh-device-close" aria-label="Cancel device selection">×</button></div><p>Keep your node nearby with Bluetooth companion firmware running. Close its connection in other apps.</p><div id="mesh-device-list" class="mesh-device-list"></div><p id="mesh-device-searching">Searching for MeshCore devices…</p><div class="dialog-actions"><button type="button" class="outline-button" id="mesh-device-cancel">Cancel</button></div></dialog>
      <dialog class="app-dialog mesh-dialog" id="mesh-pair-dialog"><form id="mesh-pair-form"><div class="dialog-head"><div><div class="section-kicker">BLUETOOTH PAIRING</div><h2>Pair with your node</h2></div></div><p id="mesh-pair-prompt"></p><label class="field-label" for="mesh-pin" id="mesh-pin-label">NODE PAIRING PIN</label><input id="mesh-pin" autocomplete="off" inputmode="numeric" maxlength="16"><div class="dialog-actions"><button type="button" id="mesh-pair-cancel" class="outline-button">Cancel</button><button type="submit" class="primary-button">Pair node</button></div></form></dialog>`;
    for (const button of document.querySelectorAll('[data-mesh-transport]')) button.addEventListener('click', () => this.selectTransport(button.dataset.meshTransport));
    $('#mesh-model').addEventListener('change', () => this.selectProfile($('#mesh-model').value));
    $('#mesh-connect-form').addEventListener('submit', event => { event.preventDefault(); void this.connect(); });
    $('#mesh-disconnect').addEventListener('click', () => void this.disconnect());
    $('#mesh-ports-refresh').addEventListener('click', () => void this.refreshPorts());
    $('#mesh-refresh').addEventListener('click', async () => { try { this.update(await api('/api/meshcore/refresh', {})); } catch (error) { this.showError(error.message); } });
    $('#mesh-search').addEventListener('input', () => this.renderConversations());
    for (const tab of document.querySelectorAll('[data-mesh-category]')) {
      tab.addEventListener('click', () => this.selectCategory(tab.dataset.meshCategory));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const category = event.key === 'Home' ? 'channels' : event.key === 'End' ? 'contacts' : this.category === 'channels' ? 'contacts' : 'channels';
        this.selectCategory(category); $(`#mesh-tab-${category}`).focus();
      });
    }
    const jump = element('button', 'mesh-unread-jump hidden'); jump.type = 'button'; jump.id = 'mesh-unread-jump';
    $('#mesh-message-form').before(jump);
    jump.addEventListener('click', () => this.jumpToLatest());
    $('#mesh-messages').addEventListener('scroll', () => this.scheduleRead(), { passive: true });
    window.addEventListener('scroll', () => this.scheduleRead(), { passive: true });
    window.addEventListener('resize', () => this.scheduleRead());
    window.addEventListener('focus', () => this.scheduleRead());
    document.addEventListener('visibilitychange', () => this.scheduleRead());
    $('#mesh-message').addEventListener('input', () => this.renderComposer());
    $('#mesh-message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#mesh-message-form').requestSubmit(); } });
    $('#mesh-message-form').addEventListener('submit', event => { event.preventDefault(); void this.send(); });
    const cancelDevice = () => { window.sdrDesktop?.selectMeshBluetoothDevice(null); $('#mesh-device-dialog').close(); };
    $('#mesh-device-cancel').addEventListener('click', cancelDevice); $('#mesh-device-close').addEventListener('click', cancelDevice);
    $('#mesh-device-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelDevice(); });
    window.sdrDesktop?.onMeshBluetoothDevices(value => this.showDevices(value));
    window.sdrDesktop?.onMeshBluetoothPairing(value => this.showPairing(value));
    $('#mesh-pair-cancel').addEventListener('click', () => this.respondPairing(false));
    $('#mesh-pair-dialog').addEventListener('cancel', event => { event.preventDefault(); this.respondPairing(false); });
    $('#mesh-pair-form').addEventListener('submit', event => { event.preventDefault(); this.respondPairing(true); });
    window.addEventListener('beforeunload', () => {
      if (this.bleSession) navigator.sendBeacon('/api/meshcore/disconnect', new Blob([JSON.stringify({ session: this.bleSession })], { type: 'application/json' }));
      this.device?.gatt.disconnect();
    });
    this.ready = this.load();
    this.render();
  }

  async load() {
    try {
      const [data, catalog] = await Promise.all([this.api('/api/meshcore/state'), this.api('/api/meshcore/devices')]);
      this.catalog = catalog;
      const groups = new Map();
      for (const device of catalog.devices) {
        if (!groups.has(device.family)) { const group = document.createElement('optgroup'); group.label = device.family; groups.set(device.family, group); $('#mesh-model').append(group); }
        groups.get(device.family).append(new Option(`${device.name} · ${device.platform}`, device.id));
      }
      this.profileId = meshProfile(catalog, data.config.modelId)?.id || 'auto'; $('#mesh-model').value = this.profileId;
      this.update(data);
      this.selectTransport(data.config.transport || 'usb', true);
      $('#mesh-host').value = data.config.host || ''; $('#mesh-tcp-port').value = data.config.port || 5000;
    } catch (error) { this.showError(error.message); }
    finally { this.catalogLoaded = true; this.render(); }
  }
  async show() {
    await this.ready; this.scheduleRead();
    if (this.transport === 'usb' && !this.portsLoaded) await this.refreshPorts();
  }
  selectTransport(name, force = false) {
    if (!force && (this.localBusy || ['connecting', 'syncing', 'connected'].includes(this.data.phase))) return;
    if (!force && !this.profile().transports.includes(name)) return;
    this.transport = name;
    for (const button of document.querySelectorAll('[data-mesh-transport]')) button.setAttribute('aria-pressed', String(button.dataset.meshTransport === name));
    for (const transport of ['usb', 'wifi', 'bluetooth']) $(`#mesh-${transport}-fields`).classList.toggle('hidden', transport !== name);
    this.render();
    if (name === 'usb' && !this.portsLoaded) void this.refreshPorts();
  }
  profile() { return meshProfile(this.catalog, this.profileId) || meshProfile(this.catalog); }
  selectProfile(id) {
    if (this.localBusy || ['connecting', 'syncing', 'connected'].includes(this.data.phase) || !meshProfile(this.catalog, id)) return;
    this.profileId = id;
    const profile = this.profile();
    if (!profile.transports.includes(this.transport)) this.selectTransport(profile.transports.includes('usb') ? 'usb' : profile.transports[0], true);
    else this.render();
  }
  async refreshPorts() {
    if (this.loadingPorts) return; this.loadingPorts = true; $('#mesh-ports-refresh').disabled = true;
    try {
      const { ports } = await this.api('/api/meshcore/ports'), selected = $('#mesh-port').value || this.data.config.path;
      $('#mesh-port').replaceChildren(new Option(ports.length ? 'Select your node’s COM port' : 'No serial ports detected', ''));
      for (const port of ports) $('#mesh-port').append(new Option(`${port.path}${port.friendlyName || port.manufacturer ? ` · ${port.friendlyName || port.manufacturer}` : ''}${port.vendorId ? ` · USB ${port.vendorId}:${port.productId || '—'}` : ''}${port.serialNumber ? ` · ${port.serialNumber}` : ''}`, port.path));
      if (ports.some(port => port.path === selected)) $('#mesh-port').value = selected;
      this.portsLoaded = true;
    } catch (error) { this.showError(`USB serial: ${error.message}`); }
    finally { this.loadingPorts = false; this.render(); }
  }

  async connect() {
    if (this.localBusy || this.data.connected) return;
    const attempt = ++this.attempt; this.localBusy = true; this.localError = ''; this.render();
    let session, bluetoothSelected = false;
    const current = () => { if (attempt !== this.attempt) throw new Error('Connection cancelled.'); };
    try {
      if (this.transport === 'bluetooth') {
        if (!navigator.bluetooth?.requestDevice) throw new Error('Bluetooth is unavailable. Open the SDR Extreme desktop app on a PC with Bluetooth enabled.');
        if (!this.socketReady()) throw new Error('The local app connection is reconnecting. Try again in a moment.');
        // Keep requestDevice inside the original click gesture; no await before it.
        window.sdrDesktop?.armMeshBluetooth();
        const discovery = $('#mesh-ble-all').checked ? { acceptAllDevices: true, optionalServices: [SERVICE] } : { filters: [{ services: [SERVICE] }, { namePrefix: 'MeshCore' }, { namePrefix: 'Meshcore' }], optionalServices: [SERVICE] };
        const device = await navigator.bluetooth.requestDevice(discovery);
        current(); this.device = device; bluetoothSelected = true;
        device.addEventListener('gattserverdisconnected', () => { if (this.device === device && this.bleSession) void this.bleFailed('The Bluetooth node disconnected. Select Connect node to pair again.'); });
        const gatt = await device.gatt.connect(); current();
        const service = await gatt.getPrimaryService(SERVICE); current();
        this.writer = await service.getCharacteristic(RX); current();
        const reader = await service.getCharacteristic(TX); current();
        reader.addEventListener('characteristicvaluechanged', event => {
          const view = event.target.value, frame = btoa(String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset, view.byteLength)));
          const token = this.bleSession;
          if (token) this.readQueue = this.readQueue.then(() => this.api('/api/meshcore/ble/rx', { session: token, frame })).catch(error => { if (this.bleSession === token) void this.bleFailed(error.message); });
        });
        await reader.startNotifications(); current();
        const data = await this.api('/api/meshcore/connect', { transport: 'bluetooth', modelId: this.profileId }); session = data.session;
        current(); this.bleSession = session; this.writeQueue = Promise.resolve(); this.readQueue = Promise.resolve(); this.update(data);
        this.heartbeat = setInterval(() => { if (this.bleSession === session) this.api('/api/meshcore/ble/heartbeat', { session }).catch(error => void this.bleFailed(error.message)); }, 10000);
        await this.api('/api/meshcore/ble/start', { session }); current();
      } else {
        const data = await this.api('/api/meshcore/connect', { transport: this.transport, modelId: this.profileId, path: $('#mesh-port').value, host: $('#mesh-host').value, port: Number($('#mesh-tcp-port').value) });
        session = data.session; current(); this.update(data);
      }
    } catch (error) {
      if (session && attempt !== this.attempt) await this.api('/api/meshcore/disconnect', { session }).catch(() => {});
      if (attempt === this.attempt) {
        if (this.bleSession) await this.bleFailed(error.message); else this.closeGatt();
        this.localError = error.name === 'NotFoundError' ? bluetoothSelected ? 'The selected device does not expose the MeshCore companion Bluetooth service and characteristics. Confirm its firmware and connection mode.' : 'No Bluetooth node selected. You can try again when the node is ready.' : error.message;
      }
    } finally { if (attempt === this.attempt) { this.localBusy = false; this.render(); } }
  }
  closeGatt() {
    clearInterval(this.heartbeat); this.bleSession = null; this.writer = null;
    const device = this.device; this.device = null; device?.gatt.disconnect();
  }
  async bleFailed(message) {
    const session = this.bleSession; this.closeGatt(); this.localError = message;
    if (session) await this.api('/api/meshcore/ble/failed', { session, error: message }).catch(() => {});
    this.render();
  }
  async disconnect() {
    ++this.attempt; this.localBusy = false; window.sdrDesktop?.selectMeshBluetoothDevice(null);
    this.closeGatt(); this.localError = '';
    try { this.update(await this.api('/api/meshcore/disconnect', {})); } catch (error) { this.showError(error.message); }
    this.render();
  }
  handleMessage(message) {
    if (message.type === 'meshcore-state') this.update(message.mesh);
    else if (message.type === 'meshcore-frame' && message.session === this.bleSession) {
      const token = this.bleSession, writer = this.writer;
      const data = Uint8Array.from(atob(message.frame), character => character.charCodeAt(0));
      this.writeQueue = this.writeQueue.then(async () => {
        if (token !== this.bleSession || !writer) return;
        // One complete companion command per write; firmware does not reassemble chunks.
        if (writer.properties.write) await writer.writeValueWithResponse(data);
        else await writer.writeValueWithoutResponse(data);
      }).catch(error => { if (token === this.bleSession) void this.bleFailed(`Bluetooth write failed: ${error.message}`); });
    }
  }
  socketOpened() { this.api('/api/meshcore/state').then(data => this.update(data)).catch(() => {}); }
  socketClosed() { if (this.bleSession) void this.bleFailed('The local Bluetooth bridge disconnected. Connect the node again.'); }
  update(data) {
    this.data = data;
    if (['connecting', 'syncing', 'connected'].includes(data.phase) && data.config.modelId !== this.profileId) {
      this.profileId = meshProfile(this.catalog, data.config.modelId)?.id || 'auto'; $('#mesh-model').value = this.profileId;
    }
    if (['connecting', 'syncing', 'connected'].includes(data.phase) && this.transport !== data.config.transport) {
      this.selectTransport(data.config.transport, true);
      $('#mesh-host').value = data.config.host || ''; $('#mesh-tcp-port').value = data.config.port || 5000;
    }
    if (data.node) {
      if (this.nodeIdentity && this.nodeIdentity !== data.node.publicKey) {
        this.selected = ''; this.categorySelections = { channels: '', contacts: '' }; this.drafts = {}; $('#mesh-message').value = '';
      }
      this.nodeIdentity = data.node.publicKey;
    }
    const resolved = this.conversationData().resolveId(this.selected);
    if (resolved !== this.selected) {
      if (this.drafts?.[this.selected]) this.drafts[resolved] = this.drafts[this.selected];
      this.selected = resolved; this.categorySelections[this.category] = resolved;
    }
    if (this.bleSession && (data.connectionId !== this.bleSession || ['disconnected', 'error'].includes(data.phase))) this.closeGatt();
    this.render();
  }
  showError(message) { this.localError = message; this.render(); }

  conversationData() {
    if (this.conversationsCache?.data === this.data) return this.conversationsCache;
    const targets = this.data.channels.map(row => ({ id: `channel:${row.index}`, name: row.name, detail: `Channel ${row.index}`, channel: true, writable: true }));
    for (const contact of this.data.contacts) targets.push({ id: `contact:${contact.publicKey}`, name: contact.name || contact.publicKey.slice(0, 12), detail: TYPES[contact.type] || 'Node', writable: contact.type === 1, publicKey: contact.publicKey });
    const byId = new Map(targets.map(target => [target.id, target])), prefixes = new Map(), groups = new Map();
    const unread = { channels: 0, contacts: 0, total: 0 };
    const resolveId = recipient => {
      if (!recipient || byId.has(recipient) || !recipient.startsWith('contact:')) return recipient;
      if (!prefixes.has(recipient)) {
        const matches = this.data.contacts.filter(contact => contact.publicKey.startsWith(recipient.slice(8)));
        prefixes.set(recipient, matches.length === 1 ? `contact:${matches[0].publicKey}` : recipient);
      }
      return prefixes.get(recipient);
    };
    for (const message of this.data.messages) {
      const recipient = resolveId(message.recipient);
      if (!byId.has(recipient)) {
        const target = { id: recipient, name: recipient.startsWith('channel:') ? `Channel ${recipient.slice(8)}` : message.sender || recipient.slice(8, 20), detail: 'History · not in node list', writable: false, channel: recipient.startsWith('channel:') };
        targets.push(target); byId.set(recipient, target);
      }
      if (!groups.has(recipient)) groups.set(recipient, { messages: [], unread: 0 });
      const group = groups.get(recipient); group.messages.push(message);
      if (message.direction === 'in' && message.unread === true) {
        group.unread++; unread[recipient.startsWith('channel:') ? 'channels' : 'contacts']++; unread.total++;
      }
    }
    return this.conversationsCache = { data: this.data, targets, groups, unread, resolveId };
  }
  targets() { return this.conversationData().targets; }
  conversationMessages() { return this.conversationData().groups.get(this.selected)?.messages || []; }
  selectCategory(category) {
    if (!['channels', 'contacts'].includes(category) || category === this.category) return;
    this.categorySelections[this.category] = this.selected;
    this.category = category; $('#mesh-search').value = '';
    this.selectConversation(this.conversationData().resolveId(this.categorySelections[category]));
  }
  selectConversation(recipient) {
    if (this.selected !== recipient) {
      if (this.selected) this.drafts = { ...this.drafts, [this.selected]: $('#mesh-message').value };
      this.selected = recipient; $('#mesh-message').value = this.drafts?.[recipient] || '';
    }
    this.categorySelections[this.category] = recipient;
    this.messageSignature = null; this.forceScroll = true;
    this.renderConversations(); this.renderMessages(); this.renderComposer(); this.scheduleRead();
  }
  atLatestMessage() {
    const container = $('#mesh-messages');
    return container.clientHeight > 0 && container.scrollHeight - container.scrollTop - container.clientHeight < 35;
  }
  canReadConversation() {
    const target = this.targets().find(row => row.id === this.selected);
    if (!this.data.node || !target || Boolean(target.channel) !== (this.category === 'channels') ||
      !$('#page-meshcore').classList.contains('active') || document.visibilityState !== 'visible' || !document.hasFocus() || !this.atLatestMessage()) return false;
    const container = $('#mesh-messages'), latest = container.lastElementChild?.getBoundingClientRect(), bounds = container.getBoundingClientRect();
    // The page can be active while connection controls fill the viewport.
    // Wait until the end of the conversation is actually on screen as well.
    return Boolean(latest && latest.bottom <= Math.min(window.innerHeight, bounds.bottom) + 1 && latest.bottom > Math.max(0, bounds.top));
  }
  scheduleRead() {
    clearTimeout(this.readTimer);
    this.readTimer = setTimeout(() => void this.markVisibleRead(), 180);
  }
  async markVisibleRead() {
    if (!this.canReadConversation()) return;
    const node = this.data.node.publicKey;
    const ids = this.conversationMessages().filter(message => message.direction === 'in' && message.unread === true && !this.pendingReads.has(message.id)).map(message => message.id);
    if (!ids.length) return;
    for (const id of ids) this.pendingReads.add(id);
    try {
      const result = await this.api('/api/meshcore/read', { node, ids });
      if (result.node !== this.data.node?.publicKey) return;
      const readIds = new Set(result.ids);
      for (const message of this.data.messages) if (readIds.has(message.id)) message.unread = false;
      this.conversationsCache = null; this.renderConversations(); this.renderUnreadJump();
    } catch {
      // Keep the badges until the read is saved. A focus, scroll, reconnect or
      // later state update can retry; local read failures must not close BLE.
    } finally { for (const id of ids) this.pendingReads.delete(id); }
  }
  jumpToLatest() {
    const container = $('#mesh-messages'); container.scrollTop = container.scrollHeight;
    if ($('#page-meshcore').classList.contains('active')) container.lastElementChild?.scrollIntoView({ block: 'nearest' });
    this.scheduleRead();
  }
  renderUnreadJump() {
    const count = this.conversationData().groups.get(this.selected)?.unread || 0;
    $('#mesh-unread-jump').textContent = `${count} new message${count === 1 ? '' : 's'} ↓`;
    $('#mesh-unread-jump').classList.toggle('hidden', !count || !this.selected);
  }
  render() {
    const data = this.data, busy = this.localBusy || ['connecting', 'syncing'].includes(data.phase), locked = busy || data.connected;
    const profile = this.profile();
    const labels = { disconnected: 'Not connected', connecting: 'Connecting…', syncing: 'Syncing node…', connected: 'Node connected', error: 'Connection interrupted' };
    $('#mesh-state').dataset.phase = busy ? 'connecting' : data.phase;
    $('#mesh-state span').textContent = this.localBusy ? 'Connecting…' : labels[data.phase] || data.phase;
    for (const button of document.querySelectorAll('[data-mesh-transport]')) {
      const available = profile.transports.includes(button.dataset.meshTransport);
      button.disabled = locked || !available;
      button.title = available ? `${meshTransportName(button.dataset.meshTransport)} · requires the matching companion firmware` : `Not available in this board’s companion firmware definitions. Use ${profile.transports.map(meshTransportName).join(' or ')}.`;
    }
    $('#mesh-model').disabled = locked || !this.catalogLoaded; $('#mesh-ble-all').disabled = locked;
    $('#mesh-profile-capabilities').textContent = `${profile.platform ? profile.platform + ' · ' : ''}${profile.transports.map(meshTransportName).join(' · ')}`;
    const catalogVersion = this.catalog.release?.tag.replace('companion-', '') || '';
    $('#mesh-profile-note').textContent = profile.id === 'auto' ? `Standard companion protocol · ${this.catalog.devices.length} board profiles${catalogVersion ? ` (${catalogVersion})` : ''}. Auto also accepts compatible unlisted/custom nodes.` : `Interfaces across ${catalogVersion || 'upstream'} firmware builds; your installed build selects what is active. ${profile.transports.includes('wifi') ? 'Enable and configure Wi-Fi on the node before using TCP.' : 'Wi-Fi is unavailable in this profile; use USB or Bluetooth where listed.'}`;
    $('#mesh-connection-help').textContent = meshConnectionHelp(profile, this.transport);
    for (const id of ['mesh-host', 'mesh-tcp-port', 'mesh-port']) $('#' + id).disabled = locked;
    $('#mesh-ports-refresh').disabled = locked || this.loadingPorts;
    $('#mesh-connect').disabled = locked || !this.catalogLoaded;
    $('#mesh-connect').textContent = data.connected ? 'Connected' : busy ? 'Connecting…' : this.transport === 'bluetooth' ? 'Choose Bluetooth node →' : 'Connect node →';
    $('#mesh-disconnect').classList.toggle('hidden', !locked);
    $('#mesh-disconnect').textContent = busy ? 'Cancel connection' : 'Disconnect';
    $('#mesh-refresh').disabled = !data.connected || data.refreshing;
    $('#mesh-refresh').textContent = data.refreshing ? 'Syncing…' : 'Sync node';
    $('#mesh-error').textContent = this.localError || data.error || ''; $('#mesh-error').classList.toggle('hidden', !$('#mesh-error').textContent);
    $('#mesh-warning').textContent = data.warning || ''; $('#mesh-warning').classList.toggle('hidden', !data.warning);
    const node = data.node;
    $('#mesh-node-name').textContent = node?.name || (profile.id === 'auto' ? 'MeshCore companion node' : profile.name);
    $('#mesh-node-detail').textContent = node ? `${node.publicKey.slice(0, 16)}… · ${data.config.transport === 'usb' ? `${data.config.path} · USB` : data.config.transport === 'wifi' ? `${data.config.host}:${data.config.port} · Wi-Fi` : 'Bluetooth LE'}${node.protocol ? ` · Protocol ${node.protocol}` : ''}${data.connected ? '' : ' · Offline'}` : 'Connect to read your node’s identity and radio settings.';
    if (node?.firmwareVersion) $('#mesh-node-detail').textContent += ` · Firmware ${node.firmwareVersion}`;
    $('#mesh-node-detail').title = node ? `${node.publicKey}\n${node.model || 'MeshCore'}${node.buildDate ? ` · ${node.buildDate}` : ''}` : '';
    $('#mesh-node-model').textContent = node ? `Device: ${node.detectedProfile?.name || node.model || 'Model not reported'}${node.detectedProfile?.platform ? ` · ${node.detectedProfile.platform}` : ''}` : '';
    $('#mesh-node-frequency').textContent = node ? `${Number(node.frequency).toFixed(3)} MHz` : '—';
    $('#mesh-node-radio').textContent = node ? `SF${node.spreadingFactor} · ${node.bandwidth} kHz · CR${node.codingRate}` : '—';
    $('#mesh-node-battery').textContent = node?.batteryMillivolts ? `${(node.batteryMillivolts / 1000).toFixed(2)} V` : '—';
    $('#mesh-contact-count').textContent = node ? String(data.contacts.length) : '—';
    this.renderConversations(); this.renderMessages(); this.renderComposer(); this.scheduleRead();
  }
  renderConversations() {
    const container = $('#mesh-conversation-list'), query = $('#mesh-search').value.trim().toLowerCase();
    const { targets, groups, unread } = this.conversationData();
    const badge = (id, count) => { $(id).textContent = String(count); $(id).classList.toggle('hidden', count === 0); };
    for (const category of ['channels', 'contacts']) {
      const tab = $(`#mesh-tab-${category}`), active = category === this.category;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      tab.setAttribute('aria-label', `${category === 'channels' ? 'Channels' : 'Contacts'}, ${unread[category]} unread messages`);
      badge(`#mesh-${category}-unread`, unread[category]);
    }
    badge('#mesh-nav-unread', unread.total);
    const nav = document.querySelector('.nav-item[data-page="meshcore"]');
    nav.setAttribute('aria-label', unread.total ? `MeshCore, ${unread.total} unread messages` : 'MeshCore');
    nav.title = unread.total ? `${unread.channels} channel messages · ${unread.contacts} direct messages unread` : 'MeshCore';
    const announcement = `${unread.channels} unread channel messages. ${unread.contacts} unread direct messages.`;
    if ($('#mesh-unread-status').textContent !== announcement) $('#mesh-unread-status').textContent = announcement;
    $('#mesh-conversation-panel').setAttribute('aria-labelledby', `mesh-tab-${this.category}`);
    $('#mesh-search-label').textContent = `Search ${this.category}`; $('#mesh-search').placeholder = `Search ${this.category}…`;
    const categoryTargets = targets.filter(row => Boolean(row.channel) === (this.category === 'channels'));
    $('#mesh-conversation-count').textContent = String(categoryTargets.length); $('#mesh-conversation-count').title = `${categoryTargets.length} ${this.category}`;
    container.replaceChildren();
    const rows = categoryTargets.filter(row => `${row.name} ${row.detail}`.toLowerCase().includes(query));
      for (const row of rows) {
        const count = groups.get(row.id)?.unread || 0;
        const button = element('button', `mesh-conversation${this.selected === row.id ? ' selected' : ''}${count ? ' has-unread' : ''}`); button.type = 'button'; button.setAttribute('aria-pressed', String(this.selected === row.id));
        button.setAttribute('aria-label', `${row.name}, ${row.detail}${count ? `, ${count} unread messages` : ''}`);
        button.append(element('span', `mesh-conversation-icon${row.channel ? ' channel' : ''}`, row.channel ? '#' : row.name.slice(0, 1).toUpperCase()));
        const copy = element('span', 'mesh-conversation-copy'); copy.append(element('strong', '', row.name), element('small', '', row.detail)); button.append(copy);
        if (count) { const indicator = element('span', 'mesh-unread-badge', String(count)); indicator.setAttribute('aria-hidden', 'true'); button.append(indicator); }
        button.addEventListener('click', () => this.selectConversation(row.id)); container.append(button);
      }
    if (!container.childElementCount) container.append(element('p', 'mesh-list-empty', query ? `No matching ${this.category}.` : this.data.connected ? `No ${this.category} on this node. Configure them with your existing MeshCore app, then sync here.` : `Your node’s ${this.category} will appear here.`));
    this.renderUnreadJump();
  }
  renderMessages() {
    const target = this.targets().find(row => row.id === this.selected), messages = this.conversationMessages();
    $('#mesh-chat-title').textContent = target?.name || 'Your next conversation starts here';
    $('#mesh-chat-subtitle').textContent = target ? target.channel ? 'Channel conversation · everyone with this channel key can read it' : target.writable ? 'Direct conversation · delivery receipts supported' : target.detail : 'Connect a node and select a channel or contact.';
    $('#mesh-chat-avatar').textContent = target ? target.channel ? '#' : target.name.slice(0, 1).toUpperCase() : '⌁';
    $('#mesh-chat-tag').textContent = target ? target.channel ? 'CHANNEL' : 'DIRECT' : 'MESHCORE';
    const signature = `${this.selected}:${messages.map(row => row.id + row.status).join(',')}`;
    if (signature === this.messageSignature) {
      if (this.forceScroll) this.jumpToLatest(); this.forceScroll = false;
      return;
    }
    this.messageSignature = signature;
    const container = $('#mesh-messages'), nearBottom = this.atLatestMessage(), previousScroll = container.scrollTop;
    container.replaceChildren();
    if (!messages.length) {
      const empty = element('div', 'mesh-chat-empty'); empty.append(element('div', 'mesh-empty-mark', '⌁'), element('h3', '', target ? 'A clear channel' : 'Stay connected beyond the network'), element('p', '', target ? 'No messages saved for this conversation yet. New messages will appear here.' : 'Use USB, Bluetooth, or Wi-Fi to connect your MeshCore node. Channels, contacts, and messages are read directly from it.'));
      container.append(empty);
    }
    for (const row of messages) {
      const item = element('article', `mesh-message ${row.direction === 'out' ? 'outgoing' : 'incoming'}`);
      item.append(element('div', 'mesh-message-sender', row.direction === 'out' ? 'YOU' : row.sender || target?.name || 'Node'));
      item.append(element('p', 'mesh-message-text', row.text));
      const date = new Date((row.timestamp || 0) * 1000), meta = element('div', 'mesh-message-meta');
      meta.append(element('time', '', Number.isNaN(date.valueOf()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })));
      if (row.direction === 'out') meta.append(element('span', `mesh-delivery ${row.status}`, STATUS[row.status] || row.status));
      else if (Number.isFinite(row.snr)) meta.append(element('span', '', `SNR ${row.snr} dB`));
      item.append(meta); if (row.error) item.title = row.error; container.append(item);
    }
    container.scrollTop = nearBottom || this.forceScroll ? container.scrollHeight : previousScroll; this.forceScroll = false;
  }
  renderComposer() {
    const target = this.targets().find(row => row.id === this.selected), enabled = this.data.connected && target?.writable;
    this.maxBytes = target?.channel ? Math.max(1, Math.min(150, 160 - bytes(this.data.node?.name || '') - 2)) : 150;
    const size = bytes($('#mesh-message').value.trim());
    $('#mesh-message').disabled = !enabled || this.sending;
    $('#mesh-message').placeholder = enabled ? `Message ${target.name}… (Enter to send, Shift+Enter for a new line)` : !this.data.connected ? 'Connect your node to send a message…' : 'Select a configured channel or chat contact…';
    $('#mesh-byte-count').textContent = `${size} / ${this.maxBytes} bytes`; $('#mesh-byte-count').classList.toggle('over-limit', size > this.maxBytes);
    $('#mesh-send').disabled = !enabled || this.sending || !size || size > this.maxBytes;
    $('#mesh-send').textContent = this.sending ? 'Sending…' : 'Send ↗';
    $('#mesh-send-hint').textContent = target && !target.writable ? 'This entry is read-only. Select a chat contact or configured channel.' : target?.channel ? 'Channel sends confirm acceptance by your node.' : 'Messages travel through your connected LoRa node.';
  }
  async send() {
    if ($('#mesh-send').disabled || this.sending) return;
    const recipient = this.selected, text = $('#mesh-message').value.trim(); this.sending = true; this.localError = ''; this.renderComposer();
    try {
      this.update(await this.api('/api/meshcore/send', { recipient, text }));
      if (this.selected === recipient) $('#mesh-message').value = ''; if (this.drafts) delete this.drafts[recipient];
      this.forceScroll = true; this.renderMessages();
    } catch (error) { this.showError(error.message); this.toast(error.message, 'error'); }
    finally { this.sending = false; this.renderComposer(); }
  }
  showDevices(value) {
    const dialog = $('#mesh-device-dialog');
    if (value.closed) { dialog.close(); return; }
    $('#mesh-device-list').replaceChildren();
    for (const device of value.devices || []) {
      const button = element('button', 'mesh-device-option'); button.type = 'button';
      button.append(element('strong', '', device.name), element('small', '', device.id));
      button.addEventListener('click', () => { window.sdrDesktop.selectMeshBluetoothDevice(device.id); dialog.close(); });
      $('#mesh-device-list').append(button);
    }
    $('#mesh-device-searching').textContent = value.devices?.length ? 'Select your node. The list updates while scanning.' : 'Searching… Enable Bluetooth on the node and disconnect other companion apps.';
    if (!dialog.open) dialog.showModal();
  }
  showPairing(value) {
    const dialog = $('#mesh-pair-dialog'); if (value.closed) { dialog.close(); return; }
    this.pairKind = value.kind;
    $('#mesh-pin').value = ''; $('#mesh-pin').required = value.kind === 'providePin';
    $('#mesh-pin').classList.toggle('hidden', value.kind !== 'providePin'); $('#mesh-pin-label').classList.toggle('hidden', value.kind !== 'providePin');
    $('#mesh-pair-prompt').textContent = value.kind === 'providePin' ? 'Enter the pairing PIN displayed or configured on your MeshCore node.' : value.kind === 'confirmPin' ? `Confirm that PIN ${value.pin} matches the PIN on your node (${value.device}).` : `Allow pairing with your MeshCore node (${value.device})?`;
    if (!dialog.open) dialog.showModal();
  }
  respondPairing(confirmed) {
    const pin = $('#mesh-pin').value.trim();
    if (confirmed && this.pairKind === 'providePin' && !/^[a-z0-9]{1,16}$/i.test(pin)) { $('#mesh-pin').reportValidity(); return; }
    window.sdrDesktop?.respondMeshBluetoothPairing({ confirmed, ...(this.pairKind === 'providePin' && confirmed ? { pin } : {}) });
    $('#mesh-pin').value = ''; $('#mesh-pair-dialog').close();
  }
}
