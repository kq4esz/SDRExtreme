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
    $('#page-meshcore').innerHTML = `
      <div class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span>OFF-GRID MESSAGING</div><h1>MeshCore<span class="heading-period">.</span></h1><p>Your mesh. One connected workspace.</p></div><div class="mesh-state" id="mesh-state" role="status"><i></i><span>Not connected</span></div></div>
      <section class="mesh-connect panel" aria-label="MeshCore connection">
        <div class="mesh-connect-heading"><div><div class="section-kicker">COMPANION LINK</div><h2>Connect your node</h2></div><div class="mesh-transports" role="group" aria-label="Connection method"><button type="button" data-mesh-transport="usb" aria-pressed="true">▣ <span>USB</span></button><button type="button" data-mesh-transport="bluetooth" aria-pressed="false">ᛒ <span>Bluetooth</span></button><button type="button" data-mesh-transport="wifi" aria-pressed="false">◔ <span>Wi-Fi</span></button></div></div>
        <form id="mesh-connect-form"><div class="mesh-connection-row">
          <div id="mesh-usb-fields" class="mesh-transport-fields"><div class="mesh-port-field"><label class="field-label" for="mesh-port">USB SERIAL PORT</label><div class="field-with-action"><select id="mesh-port"><option value="">Select your node’s COM port</option></select><button type="button" id="mesh-ports-refresh" class="outline-button">Refresh ports</button></div></div><span class="mesh-baud">115200 baud <span>·</span> direct USB</span></div>
          <div id="mesh-wifi-fields" class="mesh-transport-fields hidden"><div class="mesh-host-field"><label class="field-label" for="mesh-host">NODE IP ADDRESS / HOSTNAME</label><input id="mesh-host" placeholder="e.g. 192.168.1.50 or meshcore.local" autocomplete="off" maxlength="253"></div><div class="mesh-tcp-field"><label class="field-label" for="mesh-tcp-port">TCP PORT</label><input id="mesh-tcp-port" type="number" min="1" max="65535" value="5000"></div></div>
          <div id="mesh-bluetooth-fields" class="mesh-transport-fields hidden"><div class="mesh-ble-symbol">ᛒ</div><div><strong>Find a nearby MeshCore node</strong><p>Choose your Heltec V3 and enter its pairing PIN when prompted.</p></div></div>
          <div class="mesh-connect-actions"><button type="button" id="mesh-disconnect" class="outline-button hidden">Disconnect</button><button type="submit" id="mesh-connect" class="primary-button">Connect node <span>→</span></button></div>
        </div></form>
        <p class="mesh-connection-help" id="mesh-connection-help">Connect your Heltec V3 using a USB data cable. Choose its COM port; close other apps using that port.</p>
        <div id="mesh-error" class="mesh-notice error hidden" role="alert"></div><div id="mesh-warning" class="mesh-notice hidden" role="status"></div>
      </section>
      <section class="mesh-node panel" aria-label="Connected node information"><div class="mesh-node-identity"><div class="mesh-node-icon">⌘</div><div><div class="section-kicker">LOCAL NODE</div><strong id="mesh-node-name">Heltec V3 / MeshCore companion</strong><small id="mesh-node-detail">Connect to read your node’s identity and radio settings.</small></div></div><dl><div><dt>FREQUENCY</dt><dd id="mesh-node-frequency">—</dd></div><div><dt>LoRa PROFILE</dt><dd id="mesh-node-radio">—</dd></div><div><dt>BATTERY</dt><dd id="mesh-node-battery">—</dd></div><div><dt>CONTACTS</dt><dd id="mesh-contact-count">—</dd></div></dl><button type="button" id="mesh-refresh" class="outline-button" disabled>Sync node</button></section>
      <div class="mesh-workspace panel"><aside class="mesh-conversations"><div class="mesh-list-heading"><h2>Conversations</h2><span id="mesh-conversation-count">0</span></div><label class="sr-only" for="mesh-search">Search channels and contacts</label><input id="mesh-search" type="search" placeholder="Search channels & contacts…"><div class="mesh-conversation-scroll" id="mesh-conversation-list"></div></aside>
        <section class="mesh-chat" aria-label="MeshCore messages"><header class="mesh-chat-heading"><div class="mesh-chat-avatar" id="mesh-chat-avatar">⌁</div><div><h2 id="mesh-chat-title">Your next conversation starts here</h2><p id="mesh-chat-subtitle">Connect a node and select a channel or contact.</p></div><span class="mesh-chat-tag" id="mesh-chat-tag">MESHCORE</span></header><div id="mesh-messages" class="mesh-messages" role="log" aria-label="Conversation messages" aria-live="polite"></div><form id="mesh-message-form" class="mesh-composer"><label class="sr-only" for="mesh-message">Message text</label><textarea id="mesh-message" rows="2" placeholder="Select a channel or chat contact to write a message…" disabled></textarea><div class="mesh-composer-bottom"><span id="mesh-send-hint">Messages travel through your connected LoRa node.</span><span id="mesh-byte-count">0 / 150 bytes</span><button class="primary-button" id="mesh-send" type="submit" disabled>Send <span>↗</span></button></div></form></section>
      </div><p class="mesh-footer-note">MeshCore companion firmware is required. USB, BLE and Wi-Fi availability depends on your firmware build. Mesh messaging uses the node’s LoRa radio.</p>
      <dialog class="app-dialog mesh-dialog" id="mesh-device-dialog"><div class="dialog-head"><div><div class="section-kicker">BLUETOOTH LOW ENERGY</div><h2>Choose a MeshCore node</h2></div><button type="button" class="icon-button" id="mesh-device-close" aria-label="Cancel device selection">×</button></div><p>Keep your Heltec V3 nearby with Bluetooth companion firmware running. Close its connection in other apps.</p><div id="mesh-device-list" class="mesh-device-list"></div><p id="mesh-device-searching">Searching for MeshCore devices…</p><div class="dialog-actions"><button type="button" class="outline-button" id="mesh-device-cancel">Cancel</button></div></dialog>
      <dialog class="app-dialog mesh-dialog" id="mesh-pair-dialog"><form id="mesh-pair-form"><div class="dialog-head"><div><div class="section-kicker">BLUETOOTH PAIRING</div><h2>Pair with your node</h2></div></div><p id="mesh-pair-prompt"></p><label class="field-label" for="mesh-pin" id="mesh-pin-label">NODE PAIRING PIN</label><input id="mesh-pin" autocomplete="off" inputmode="numeric" maxlength="16"><div class="dialog-actions"><button type="button" id="mesh-pair-cancel" class="outline-button">Cancel</button><button type="submit" class="primary-button">Pair node</button></div></form></dialog>`;
    for (const button of document.querySelectorAll('[data-mesh-transport]')) button.addEventListener('click', () => this.selectTransport(button.dataset.meshTransport));
    $('#mesh-connect-form').addEventListener('submit', event => { event.preventDefault(); void this.connect(); });
    $('#mesh-disconnect').addEventListener('click', () => void this.disconnect());
    $('#mesh-ports-refresh').addEventListener('click', () => void this.refreshPorts());
    $('#mesh-refresh').addEventListener('click', async () => { try { this.update(await api('/api/meshcore/refresh', {})); } catch (error) { this.showError(error.message); } });
    $('#mesh-search').addEventListener('input', () => this.renderConversations());
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
      const data = await this.api('/api/meshcore/state'); this.update(data);
      this.selectTransport(data.config.transport || 'usb', true);
      $('#mesh-host').value = data.config.host || ''; $('#mesh-tcp-port').value = data.config.port || 5000;
    } catch (error) { this.showError(error.message); }
  }
  async show() { await this.ready; if (this.transport === 'usb' && !this.portsLoaded) await this.refreshPorts(); }
  selectTransport(name, force = false) {
    if (!force && (this.localBusy || ['connecting', 'syncing', 'connected'].includes(this.data.phase))) return;
    this.transport = name;
    for (const button of document.querySelectorAll('[data-mesh-transport]')) button.setAttribute('aria-pressed', String(button.dataset.meshTransport === name));
    for (const transport of ['usb', 'wifi', 'bluetooth']) $(`#mesh-${transport}-fields`).classList.toggle('hidden', transport !== name);
    $('#mesh-connection-help').textContent = name === 'wifi' ? 'Use the IP address of a node running the MeshCore Wi-Fi companion TCP service (usually port 5000). A node web page is not a companion connection.' : name === 'bluetooth' ? 'Requires Bluetooth companion firmware, Bluetooth enabled in Windows, and a free BLE connection. The desktop app provides device selection and PIN pairing.' : 'Connect your Heltec V3 using a USB data cable. Choose its COM port; close other apps using that port. The Heltec USB serial driver must be installed.';
    this.render();
    if (name === 'usb' && !this.portsLoaded) void this.refreshPorts();
  }
  async refreshPorts() {
    if (this.loadingPorts) return; this.loadingPorts = true; $('#mesh-ports-refresh').disabled = true;
    try {
      const { ports } = await this.api('/api/meshcore/ports'), selected = $('#mesh-port').value || this.data.config.path;
      $('#mesh-port').replaceChildren(new Option(ports.length ? 'Select your node’s COM port' : 'No serial ports detected', ''));
      for (const port of ports) $('#mesh-port').append(new Option(`${port.path}${port.manufacturer ? ` · ${port.manufacturer}` : ''}${port.vendorId ? ` · USB ${port.vendorId}:${port.productId || '—'}` : ''}`, port.path));
      if (ports.some(port => port.path === selected)) $('#mesh-port').value = selected;
      this.portsLoaded = true;
    } catch (error) { this.showError(`USB serial: ${error.message}`); }
    finally { this.loadingPorts = false; this.render(); }
  }

  async connect() {
    if (this.localBusy || this.data.connected) return;
    const attempt = ++this.attempt; this.localBusy = true; this.localError = ''; this.render();
    let session;
    const current = () => { if (attempt !== this.attempt) throw new Error('Connection cancelled.'); };
    try {
      if (this.transport === 'bluetooth') {
        if (!navigator.bluetooth?.requestDevice) throw new Error('Bluetooth is unavailable. Open the SDR Extreme desktop app on a PC with Bluetooth enabled.');
        if (!this.socketReady()) throw new Error('The local app connection is reconnecting. Try again in a moment.');
        // Keep requestDevice inside the original click gesture; no await before it.
        window.sdrDesktop?.armMeshBluetooth();
        const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }] });
        current(); this.device = device;
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
        const data = await this.api('/api/meshcore/connect', { transport: 'bluetooth' }); session = data.session;
        current(); this.bleSession = session; this.writeQueue = Promise.resolve(); this.readQueue = Promise.resolve(); this.update(data);
        this.heartbeat = setInterval(() => { if (this.bleSession === session) this.api('/api/meshcore/ble/heartbeat', { session }).catch(error => void this.bleFailed(error.message)); }, 10000);
        await this.api('/api/meshcore/ble/start', { session }); current();
      } else {
        const data = await this.api('/api/meshcore/connect', { transport: this.transport, path: $('#mesh-port').value, host: $('#mesh-host').value, port: Number($('#mesh-tcp-port').value) });
        session = data.session; current(); this.update(data);
      }
    } catch (error) {
      if (session && attempt !== this.attempt) await this.api('/api/meshcore/disconnect', { session }).catch(() => {});
      if (attempt === this.attempt) {
        if (this.bleSession) await this.bleFailed(error.message); else this.closeGatt();
        this.localError = error.name === 'NotFoundError' ? 'No Bluetooth node selected. You can try again when the node is ready.' : error.message;
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
    const previousNode = this.data.node?.publicKey; this.data = data;
    if (['connecting', 'syncing', 'connected'].includes(data.phase) && this.transport !== data.config.transport) {
      this.selectTransport(data.config.transport, true);
      $('#mesh-host').value = data.config.host || ''; $('#mesh-tcp-port').value = data.config.port || 5000;
    }
    if (previousNode && data.node && previousNode !== data.node.publicKey) { this.selected = ''; $('#mesh-message').value = ''; }
    if (this.bleSession && (data.connectionId !== this.bleSession || ['disconnected', 'error'].includes(data.phase))) this.closeGatt();
    this.render();
  }
  showError(message) { this.localError = message; this.render(); }

  targets() {
    const targets = this.data.channels.map(row => ({ id: `channel:${row.index}`, name: row.name, detail: `Channel ${row.index}`, channel: true, writable: true }));
    for (const contact of this.data.contacts) targets.push({ id: `contact:${contact.publicKey}`, name: contact.name || contact.publicKey.slice(0, 12), detail: TYPES[contact.type] || 'Node', writable: contact.type === 1, publicKey: contact.publicKey });
    for (const message of this.data.messages) {
      if (targets.some(target => target.id === message.recipient)) continue;
      if (message.recipient.startsWith('contact:')) {
        const prefix = message.recipient.slice(8);
        const matches = targets.filter(target => target.publicKey?.startsWith(prefix));
        if (matches.length === 1) continue;
      }
      targets.push({ id: message.recipient, name: message.recipient.startsWith('channel:') ? `Channel ${message.recipient.slice(8)}` : message.sender || message.recipient.slice(8, 20), detail: 'History · not in node list', writable: false, channel: message.recipient.startsWith('channel:') });
    }
    return targets;
  }
  conversationMessages() {
    const target = this.targets().find(row => row.id === this.selected);
    return this.data.messages.filter(message => message.recipient === this.selected || (target?.publicKey && message.recipient.startsWith('contact:') && target.publicKey.startsWith(message.recipient.slice(8))));
  }
  render() {
    const data = this.data, busy = this.localBusy || ['connecting', 'syncing'].includes(data.phase), locked = busy || data.connected;
    const labels = { disconnected: 'Not connected', connecting: 'Connecting…', syncing: 'Syncing node…', connected: 'Node connected', error: 'Connection interrupted' };
    $('#mesh-state').dataset.phase = busy ? 'connecting' : data.phase;
    $('#mesh-state span').textContent = this.localBusy ? 'Connecting…' : labels[data.phase] || data.phase;
    for (const button of document.querySelectorAll('[data-mesh-transport]')) button.disabled = locked;
    for (const id of ['mesh-host', 'mesh-tcp-port', 'mesh-port']) $('#' + id).disabled = locked;
    $('#mesh-ports-refresh').disabled = locked || this.loadingPorts;
    $('#mesh-connect').disabled = locked;
    $('#mesh-connect').textContent = data.connected ? 'Connected' : busy ? 'Connecting…' : this.transport === 'bluetooth' ? 'Choose Bluetooth node →' : 'Connect node →';
    $('#mesh-disconnect').classList.toggle('hidden', !locked);
    $('#mesh-disconnect').textContent = busy ? 'Cancel connection' : 'Disconnect';
    $('#mesh-refresh').disabled = !data.connected || data.refreshing;
    $('#mesh-refresh').textContent = data.refreshing ? 'Syncing…' : 'Sync node';
    $('#mesh-error').textContent = this.localError || data.error || ''; $('#mesh-error').classList.toggle('hidden', !$('#mesh-error').textContent);
    $('#mesh-warning').textContent = data.warning || ''; $('#mesh-warning').classList.toggle('hidden', !data.warning);
    const node = data.node;
    $('#mesh-node-name').textContent = node?.name || 'Heltec V3 / MeshCore companion';
    $('#mesh-node-detail').textContent = node ? `${node.publicKey.slice(0, 16)}… · ${data.config.transport === 'usb' ? `${data.config.path} · USB` : data.config.transport === 'wifi' ? `${data.config.host}:${data.config.port} · Wi-Fi` : 'Bluetooth LE'}${node.protocol ? ` · Protocol ${node.protocol}` : ''}${data.connected ? '' : ' · Offline'}` : 'Connect to read your node’s identity and radio settings.';
    if (node?.firmwareVersion) $('#mesh-node-detail').textContent += ` · Firmware ${node.firmwareVersion}`;
    $('#mesh-node-detail').title = node ? `${node.publicKey}\n${node.model || 'MeshCore'}${node.buildDate ? ` · ${node.buildDate}` : ''}` : '';
    $('#mesh-node-frequency').textContent = node ? `${Number(node.frequency).toFixed(3)} MHz` : '—';
    $('#mesh-node-radio').textContent = node ? `SF${node.spreadingFactor} · ${node.bandwidth} kHz · CR${node.codingRate}` : '—';
    $('#mesh-node-battery').textContent = node?.batteryMillivolts ? `${(node.batteryMillivolts / 1000).toFixed(2)} V` : '—';
    $('#mesh-contact-count').textContent = node ? String(data.contacts.length) : '—';
    this.renderConversations(); this.renderMessages(); this.renderComposer();
  }
  renderConversations() {
    const container = $('#mesh-conversation-list'), query = $('#mesh-search').value.trim().toLowerCase();
    const targets = this.targets(); $('#mesh-conversation-count').textContent = String(targets.length); container.replaceChildren();
    for (const [label, channel] of [['CHANNELS', true], ['CONTACTS', false]]) {
      const rows = targets.filter(row => Boolean(row.channel) === channel && `${row.name} ${row.detail}`.toLowerCase().includes(query));
      if (!rows.length) continue;
      container.append(element('div', 'mesh-list-label', `${label} / ${rows.length}`));
      for (const row of rows) {
        const button = element('button', `mesh-conversation${this.selected === row.id ? ' selected' : ''}`); button.type = 'button'; button.setAttribute('aria-pressed', String(this.selected === row.id));
        button.append(element('span', `mesh-conversation-icon${row.channel ? ' channel' : ''}`, row.channel ? '#' : row.name.slice(0, 1).toUpperCase()));
        const copy = element('span', 'mesh-conversation-copy'); copy.append(element('strong', '', row.name), element('small', '', row.detail)); button.append(copy);
        button.addEventListener('click', () => {
          if (this.selected !== row.id) this.drafts = { ...this.drafts, [this.selected]: $('#mesh-message').value };
          this.selected = row.id; $('#mesh-message').value = this.drafts?.[row.id] || ''; this.messageSignature = null; this.renderConversations(); this.renderMessages(); this.renderComposer();
        }); container.append(button);
      }
    }
    if (!container.childElementCount) container.append(element('p', 'mesh-list-empty', query ? 'No matching conversations.' : this.data.connected ? 'No channels or contacts on this node. Configure them with your existing MeshCore app, then sync here.' : 'Your node’s channels and contacts will appear here.'));
  }
  renderMessages() {
    const target = this.targets().find(row => row.id === this.selected), messages = this.conversationMessages();
    $('#mesh-chat-title').textContent = target?.name || 'Your next conversation starts here';
    $('#mesh-chat-subtitle').textContent = target ? target.channel ? 'Channel conversation · everyone with this channel key can read it' : target.writable ? 'Direct conversation · delivery receipts supported' : target.detail : 'Connect a node and select a channel or contact.';
    $('#mesh-chat-avatar').textContent = target ? target.channel ? '#' : target.name.slice(0, 1).toUpperCase() : '⌁';
    $('#mesh-chat-tag').textContent = target ? target.channel ? 'CHANNEL' : 'DIRECT' : 'MESHCORE';
    const signature = `${this.selected}:${messages.map(row => row.id + row.status).join(',')}`;
    if (signature === this.messageSignature) return; this.messageSignature = signature;
    const container = $('#mesh-messages'), nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
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
    if (nearBottom || this.forceScroll) container.scrollTop = container.scrollHeight; this.forceScroll = false;
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
