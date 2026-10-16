import { meshProfile, meshConnectionHelp, meshTransportName } from './lib/meshcore-devices.mjs';
import { normalizeMeshLayout, meshConversations, orderedMeshTargets } from './lib/meshcore-conversations.mjs';
import { deliveryLabel, deliveryHopLabel } from './lib/meshcore-paths.mjs';

const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const $ = selector => document.querySelector(selector);
const bytes = text => new TextEncoder().encode(text).length;
const element = (tag, className, text) => { const item = document.createElement(tag); item.className = className; if (text !== undefined) item.textContent = text; return item; };

export class MeshCoreUi {
  constructor({ api, toast, socketReady }) {
    this.api = api; this.toast = toast; this.socketReady = socketReady;
    this.data = { phase: 'disconnected', config: {}, contacts: [], channels: [], messages: [] };
    this.transport = 'usb'; this.attempt = 0; this.writeQueue = Promise.resolve(); this.readQueue = Promise.resolve(); this.selected = '';
    this.category = 'channels'; this.categorySelections = { channels: '', contacts: '' }; this.pendingReads = new Set();
    this.catalog = { devices: [], release: null }; this.profileId = 'auto';
    this.favoritesOnly = { channels: false, contacts: false }; this.drag = null; this.layoutSaving = false;
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
    const repeaterPanel = element('section', 'mesh-repeater-panel hidden'); repeaterPanel.id = 'mesh-repeater-panel'; repeaterPanel.setAttribute('aria-label', 'Repeater connection and login');
    repeaterPanel.innerHTML = `<div class="mesh-repeater-topline"><span class="section-kicker">REPEATER LINK · LoRa</span><span id="mesh-repeater-route"></span></div>
      <p id="mesh-repeater-identity" class="mesh-repeater-identity"></p><p id="mesh-repeater-access" class="mesh-repeater-access"></p>
      <form id="mesh-repeater-login-form" class="mesh-repeater-login"><div><label class="field-label" for="mesh-repeater-password">REPEATER PASSWORD</label><input type="password" id="mesh-repeater-password" maxlength="15" autocomplete="off" placeholder="Password or blank for ACL login" aria-describedby="mesh-repeater-password-help"></div><button type="submit" class="primary-button" id="mesh-repeater-login">Connect & log in</button><button type="button" class="outline-button" id="mesh-repeater-logout">End session</button></form>
      <p id="mesh-repeater-password-help" class="mesh-repeater-help">Up to 15 UTF-8 bytes. Login uses your companion’s LoRa radio. Passwords and console output are not saved.</p>
      <p id="mesh-repeater-state" class="mesh-repeater-state" role="status" aria-live="polite"></p>
      <div class="mesh-repeater-status-line"><button type="button" class="outline-button" id="mesh-repeater-status">Refresh status</button><span id="mesh-repeater-status-time"></span></div>
      <dl id="mesh-repeater-stats" class="mesh-repeater-stats hidden"></dl>`;
    $('.mesh-chat-heading').after(repeaterPanel);
    const repeaterComposer = element('form', 'mesh-composer mesh-repeater-composer hidden'); repeaterComposer.id = 'mesh-repeater-command-form';
    repeaterComposer.innerHTML = `<div class="mesh-repeater-shortcuts" role="group" aria-label="Repeater command shortcuts"><button type="button" data-mesh-command="ver">Version</button><button type="button" data-mesh-command="clock">Clock</button><button type="button" data-mesh-command="get radio">Radio settings</button><a href="https://docs.meshcore.io/cli_commands/" target="_blank" rel="noopener noreferrer">Command reference ↗</a></div><label class="sr-only" for="mesh-repeater-command">Repeater command</label><input id="mesh-repeater-command" autocomplete="off" maxlength="150" placeholder="Log in with admin access to send commands…" disabled><div class="mesh-composer-bottom"><span id="mesh-repeater-command-hint">Commands and replies stay in this session only.</span><span id="mesh-repeater-byte-count">0 / 150 bytes</span><button type="submit" class="primary-button" id="mesh-repeater-send" disabled>Send command ↗</button></div>`;
    $('#mesh-message-form').after(repeaterComposer);
    const deliveryDialog = element('dialog', 'app-dialog mesh-delivery-dialog'); deliveryDialog.id = 'mesh-delivery-dialog'; deliveryDialog.setAttribute('aria-labelledby', 'mesh-delivery-title');
    deliveryDialog.innerHTML = '<div class="dialog-head"><div><div class="section-kicker">MESSAGE DELIVERY</div><h2 id="mesh-delivery-title">Receipt & path</h2></div><button type="button" class="icon-button" id="mesh-delivery-close" aria-label="Close delivery details">×</button></div><div id="mesh-delivery-content" class="mesh-delivery-content"></div><div class="dialog-actions"><button type="button" class="outline-button" id="mesh-delivery-done">Done</button></div>';
    $('#page-meshcore').append(deliveryDialog);
    for (const id of ['mesh-delivery-close', 'mesh-delivery-done']) $('#' + id).addEventListener('click', () => deliveryDialog.close());
    deliveryDialog.addEventListener('close', () => { this.deliveryMessageId = null; });
    $('#mesh-repeater-login-form').addEventListener('submit', event => { event.preventDefault(); void this.repeaterAction('login'); });
    $('#mesh-repeater-logout').addEventListener('click', () => void this.repeaterAction('logout'));
    $('#mesh-repeater-status').addEventListener('click', () => void this.repeaterAction('status'));
    $('#mesh-repeater-command-form').addEventListener('submit', event => { event.preventDefault(); if (!$('#mesh-repeater-send').disabled) void this.repeaterAction('command'); });
    $('#mesh-repeater-command').addEventListener('input', () => this.renderRepeater());
    for (const button of document.querySelectorAll('[data-mesh-command]')) button.addEventListener('click', () => { $('#mesh-repeater-command').value = button.dataset.meshCommand; this.renderRepeater(); $('#mesh-repeater-command').focus(); });
    for (const button of document.querySelectorAll('[data-mesh-transport]')) button.addEventListener('click', () => this.selectTransport(button.dataset.meshTransport));
    $('#mesh-model').addEventListener('change', () => this.selectProfile($('#mesh-model').value));
    $('#mesh-connect-form').addEventListener('submit', event => { event.preventDefault(); void this.connect(); });
    $('#mesh-disconnect').addEventListener('click', () => void this.disconnect());
    $('#mesh-ports-refresh').addEventListener('click', () => void this.refreshPorts());
    $('#mesh-refresh').addEventListener('click', async () => { try { this.update(await api('/api/meshcore/refresh', {})); } catch (error) { this.showError(error.message); } });
    $('#mesh-search').addEventListener('input', () => this.renderConversations());
    const favorites = element('button', 'mesh-favorites-filter', '☆ Favorites'); favorites.type = 'button'; favorites.id = 'mesh-favorites-filter'; favorites.setAttribute('aria-pressed', 'false');
    $('#mesh-search').after(favorites);
    favorites.addEventListener('click', () => { this.favoritesOnly[this.category] = !this.favoritesOnly[this.category]; this.renderConversations(); });
    const listHelp = element('p', 'mesh-list-help', 'Drag ⋮⋮ to arrange. Star favorites or pin to the top.'); listHelp.id = 'mesh-list-help';
    $('#mesh-conversation-list').before(listHelp);
    const layoutStatus = element('p', 'mesh-layout-status sr-only'); layoutStatus.id = 'mesh-layout-status'; layoutStatus.setAttribute('role', 'status');
    $('#mesh-conversation-list').after(layoutStatus);
    $('#mesh-conversation-list').addEventListener('dragover', event => {
      if (!this.validConversationDrag()) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move';
      const bounds = $('#mesh-conversation-list').getBoundingClientRect();
      if (event.clientY < bounds.top + 30) $('#mesh-conversation-list').scrollTop -= 12;
      else if (event.clientY > bounds.bottom - 30) $('#mesh-conversation-list').scrollTop += 12;
    });
    $('#mesh-conversation-list').addEventListener('drop', event => {
      if (!this.validConversationDrag()) return;
      event.preventDefault();
      const rows = this.visibleConversationRows(), target = rows.at(-1), source = this.drag;
      this.finishDrag();
      if (target && target.id !== source.id) void this.saveLayout({ action: 'move', category: source.category, id: source.id, target: target.id, before: false });
    });
    for (const tab of document.querySelectorAll('[data-mesh-category]')) {
      tab.addEventListener('click', () => this.selectCategory(tab.dataset.meshCategory));
      tab.addEventListener('keydown', event => {
        if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          const order = this.layout().tabOrder, index = order.indexOf(tab.dataset.meshCategory), next = index + (event.key === 'ArrowLeft' ? -1 : 1);
          if (next >= 0 && next < order.length) void this.saveLayout({ action: 'tabs', order: [...order].reverse() });
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const order = this.layout().tabOrder;
        const category = event.key === 'Home' ? order[0] : event.key === 'End' ? order.at(-1) : this.category === 'channels' ? 'contacts' : 'channels';
        this.selectCategory(category); $(`#mesh-tab-${category}`).focus();
      });
      tab.addEventListener('dragstart', event => {
        if (!this.data.node || this.layoutSaving) { event.preventDefault(); return; }
        this.drag = { kind: 'tab', node: this.data.node.publicKey, category: tab.dataset.meshCategory };
        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-sdrextreme-meshcore-tab', this.drag.category);
        tab.classList.add('mesh-tab-dragging');
      });
      tab.addEventListener('dragover', event => {
        if (this.drag?.kind !== 'tab' || this.drag.node !== this.data.node?.publicKey || this.drag.category === tab.dataset.meshCategory) return;
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; tab.classList.add('mesh-tab-drop');
      });
      tab.addEventListener('dragleave', () => tab.classList.remove('mesh-tab-drop'));
      tab.addEventListener('drop', event => {
        if (this.drag?.kind !== 'tab' || this.drag.node !== this.data.node?.publicKey || this.drag.category === tab.dataset.meshCategory) return;
        event.preventDefault(); event.stopPropagation(); const order = [...this.layout().tabOrder].reverse(); this.finishDrag();
        void this.saveLayout({ action: 'tabs', order });
      });
      tab.addEventListener('dragend', () => this.finishDrag());
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
    if (this.drag && this.drag.node !== data.node?.publicKey) this.finishDrag(false);
    if (data.node?.publicKey === this.data.node?.publicKey && this.data.layout?.revision > (data.layout?.revision || 0)) data = { ...data, layout: this.data.layout };
    if (data.connectionId !== this.data.connectionId) { $('#mesh-repeater-password').value = ''; $('#mesh-repeater-command').value = ''; }
    if (data.connectionId && data.connectionId === this.data.connectionId) {
      const existing = new Map(this.data.messages.filter(row => row.direction === 'out' && row.delivery).map(row => [row.id, row]));
      data = { ...data, messages: data.messages.map(row => existing.get(row.id)?.delivery.revision > (row.delivery?.revision ?? -1) ? existing.get(row.id) : row) };
    }
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
        this.favoritesOnly = { channels: false, contacts: false };
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
    return this.conversationsCache = { data: this.data, ...meshConversations(this.data) };
  }
  targets() { return this.conversationData().targets; }
  conversationMessages() {
    const target = this.targets().find(row => row.id === this.selected);
    const history = this.conversationData().groups.get(this.selected)?.messages || [];
    return target?.repeater ? [...history, ...(this.data.repeaters?.[target.publicKey]?.events || [])] : history;
  }
  layout() { return normalizeMeshLayout(this.data.layout, this.conversationData().resolveId); }
  visibleConversationRows() {
    const query = $('#mesh-search').value.trim().toLowerCase();
    return orderedMeshTargets(this.targets(), this.layout(), this.category)
      .filter(row => !this.favoritesOnly[this.category] || row.favorite)
      .filter(row => `${row.name} ${row.detail}`.toLowerCase().includes(query));
  }
  async saveLayout(action, focusKey = document.activeElement?.dataset.meshFocus) {
    if (this.layoutSaving || !this.data.node) return;
    const node = this.data.node.publicKey;
    this.layoutSaving = true; this.renderConversations();
    $('#mesh-layout-status').textContent = 'Saving conversation layout…';
    try {
      const result = await this.api('/api/meshcore/organize', { node, ...action });
      if (result.node !== this.data.node?.publicKey) return;
      // A state broadcast or incoming message can arrive before the HTTP reply.
      // Merge just the layout, and never replace a newer layout revision.
      if (result.layout.revision >= this.layout().revision) this.data = { ...this.data, layout: result.layout };
      $('#mesh-layout-status').textContent = 'Conversation layout saved.';
    } catch (error) {
      $('#mesh-layout-status').textContent = 'Could not confirm the saved conversation layout.';
      this.toast(error.message, 'error');
    } finally {
      this.layoutSaving = false; this.renderConversations();
      if (node === this.data.node?.publicKey && focusKey && (!document.activeElement || document.activeElement === document.body || document.activeElement.dataset.meshFocus === focusKey)) {
        this.focusListControl(focusKey);
      }
    }
  }
  focusListControl(key) {
    const control = [...$('#mesh-conversation-list').querySelectorAll('[data-mesh-focus]')].find(item => item.dataset.meshFocus === key);
    if (control) control.focus({ preventScroll: true });
    else $('#mesh-favorites-filter').focus({ preventScroll: true });
  }
  validConversationDrag() {
    return this.drag?.kind === 'conversation' && this.drag.node === this.data.node?.publicKey && this.drag.category === this.category && !this.layoutSaving;
  }
  finishDrag(render = true) {
    const hadDrag = Boolean(this.drag); this.drag = null;
    for (const item of document.querySelectorAll('.mesh-drop-before, .mesh-drop-after, .mesh-row-dragging, .mesh-tab-dragging, .mesh-tab-drop')) item.classList.remove('mesh-drop-before', 'mesh-drop-after', 'mesh-row-dragging', 'mesh-tab-dragging', 'mesh-tab-drop');
    $('#mesh-list-help').textContent = 'Drag ⋮⋮ to arrange. Star favorites or pin to the top.';
    if (hadDrag && render) this.renderConversations();
  }
  selectCategory(category) {
    if (!['channels', 'contacts'].includes(category) || category === this.category) return;
    this.finishDrag(false);
    this.categorySelections[this.category] = this.selected;
    this.category = category; $('#mesh-search').value = '';
    this.selectConversation(this.conversationData().resolveId(this.categorySelections[category]));
  }
  selectConversation(recipient) {
    if (this.selected !== recipient) {
      $('#mesh-repeater-password').value = ''; $('#mesh-repeater-command').value = '';
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
    const { targets, groups, unread } = this.conversationData(), layout = this.layout();
    const badge = (id, count) => { $(id).textContent = String(count); $(id).classList.toggle('hidden', count === 0); };
    for (const category of ['channels', 'contacts']) {
      const tab = $(`#mesh-tab-${category}`), active = category === this.category;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      tab.setAttribute('aria-label', `${category === 'channels' ? 'Channels' : 'Contacts'}, ${unread[category]} unread messages`);
      tab.draggable = Boolean(this.data.node) && !this.layoutSaving;
      tab.title = this.data.node ? 'Drag to swap tabs. Alt+Left / Right also moves this tab.' : 'Connect a node to save your tab order.';
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
    const favoriteCount = categoryTargets.filter(row => layout[this.category].favorites.includes(row.id)).length;
    $('#mesh-favorites-filter').textContent = `${this.favoritesOnly[this.category] ? '★' : '☆'} Favorites (${favoriteCount})`;
    $('#mesh-favorites-filter').setAttribute('aria-pressed', String(this.favoritesOnly[this.category]));
    $('#mesh-favorites-filter').title = this.favoritesOnly[this.category] ? `Show all ${this.category}` : `Show favorite ${this.category} only`;
    this.renderUnreadJump();
    // Keep the native drag source alive when live messages refresh the page.
    if (this.drag) return;
    const tablist = $('.mesh-category-tabs');
    if ([...tablist.children].map(tab => tab.dataset.meshCategory).join() !== layout.tabOrder.join()) {
      const focusedTab = tablist.contains(document.activeElement) ? document.activeElement : null;
      tablist.append(...layout.tabOrder.map(category => $(`#mesh-tab-${category}`)));
      focusedTab?.focus({ preventScroll: true });
    }
    const focusedKey = container.contains(document.activeElement) ? document.activeElement.dataset.meshFocus : null;
    const scrollTop = container.scrollTop, rows = this.visibleConversationRows(), editable = Boolean(this.data.node) && !this.layoutSaving;
    container.replaceChildren();
    for (const pinned of [true, false]) {
      const sectionRows = rows.filter(row => row.pinned === pinned);
      if (!sectionRows.length) continue;
      if (pinned || rows.some(row => row.pinned)) {
        const heading = element('div', 'mesh-list-section'); heading.append(element('span', '', pinned ? 'PINNED' : this.category.toUpperCase()), element('span', '', String(sectionRows.length))); container.append(heading);
      }
      for (const row of sectionRows) {
        const count = groups.get(row.id)?.unread || 0;
        const wrapper = element('div', `mesh-conversation-row${this.selected === row.id ? ' selected' : ''}${row.pinned ? ' is-pinned' : ''}`);
        wrapper.dataset.recipient = row.id;
        const handle = element('button', 'mesh-drag-handle', '⋮⋮'); handle.type = 'button'; handle.draggable = editable; handle.disabled = !editable;
        handle.dataset.meshFocus = `move:${row.id}`;
        handle.setAttribute('aria-label', `Reorder ${row.name}`); handle.title = 'Drag to reorder. Alt+Up / Down also moves this entry. Drop into Pinned to pin it; drop into the regular list to unpin it.';
        handle.addEventListener('dragstart', event => {
          if (!this.data.node || this.layoutSaving) { event.preventDefault(); return; }
          this.drag = { kind: 'conversation', node: this.data.node.publicKey, category: this.category, id: row.id, pinned: row.pinned };
          event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-sdrextreme-meshcore-conversation', row.id);
          event.dataTransfer.setDragImage(wrapper, Math.min(40, wrapper.clientWidth / 2), wrapper.clientHeight / 2); wrapper.classList.add('mesh-row-dragging');
        });
        handle.addEventListener('dragend', () => this.finishDrag());
        handle.addEventListener('keydown', event => {
          if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); const index = rows.findIndex(item => item.id === row.id), before = event.key === 'ArrowUp', target = rows[index + (before ? -1 : 1)];
          if (target) void this.saveLayout({ action: 'move', category: this.category, id: row.id, target: target.id, before }, handle.dataset.meshFocus);
        });
        wrapper.addEventListener('dragover', event => {
          if (!this.validConversationDrag() || this.drag.id === row.id) return;
          event.preventDefault(); event.dataTransfer.dropEffect = 'move';
          const before = event.clientY < wrapper.getBoundingClientRect().top + wrapper.clientHeight / 2;
          for (const other of container.querySelectorAll('.mesh-drop-before, .mesh-drop-after')) if (other !== wrapper) other.classList.remove('mesh-drop-before', 'mesh-drop-after');
          wrapper.classList.toggle('mesh-drop-before', before); wrapper.classList.toggle('mesh-drop-after', !before);
          const hint = `Drop ${before ? 'above' : 'below'} ${row.name}${this.drag.pinned !== row.pinned ? row.pinned ? ' and pin to the top.' : ' and unpin.' : '.'}`;
          if ($('#mesh-list-help').textContent !== hint) $('#mesh-list-help').textContent = hint;
        });
        wrapper.addEventListener('dragleave', event => { if (!wrapper.contains(event.relatedTarget)) wrapper.classList.remove('mesh-drop-before', 'mesh-drop-after'); });
        wrapper.addEventListener('drop', event => {
          if (!this.validConversationDrag()) return;
          event.preventDefault(); event.stopPropagation(); const source = this.drag, before = event.clientY < wrapper.getBoundingClientRect().top + wrapper.clientHeight / 2;
          this.finishDrag();
          if (source.id !== row.id) void this.saveLayout({ action: 'move', category: source.category, id: source.id, target: row.id, before }, `move:${source.id}`);
        });
        const button = element('button', `mesh-conversation${this.selected === row.id ? ' selected' : ''}${count ? ' has-unread' : ''}`); button.type = 'button'; button.setAttribute('aria-pressed', String(this.selected === row.id));
        button.dataset.meshFocus = `open:${row.id}`;
        button.setAttribute('aria-label', `${row.name}, ${row.detail}${row.pinned ? ', pinned' : ''}${row.favorite ? ', favorite' : ''}${count ? `, ${count} unread messages` : ''}`);
        button.title = `${row.name} · ${row.detail}`;
        button.append(element('span', `mesh-conversation-icon${row.channel ? ' channel' : ''}`, row.channel ? '#' : row.name.slice(0, 1).toUpperCase()));
        const copy = element('span', 'mesh-conversation-copy'); copy.append(element('strong', '', row.name), element('small', '', row.detail)); button.append(copy);
        if (count) { const indicator = element('span', 'mesh-unread-badge', String(count)); indicator.setAttribute('aria-hidden', 'true'); button.append(indicator); }
        button.addEventListener('click', () => this.selectConversation(row.id));
        const actions = element('div', 'mesh-row-actions');
        const favorite = element('button', `mesh-row-action${row.favorite ? ' is-favorite' : ''}`, row.favorite ? '★' : '☆'); favorite.type = 'button'; favorite.disabled = !editable;
        favorite.dataset.meshFocus = `favorite:${row.id}`; favorite.setAttribute('aria-pressed', String(row.favorite));
        favorite.title = `${row.favorite ? 'Remove' : 'Add'} ${row.name} ${row.favorite ? 'from' : 'to'} favorites`; favorite.setAttribute('aria-label', favorite.title);
        favorite.addEventListener('click', () => void this.saveLayout({ action: 'favorite', category: this.category, id: row.id, enabled: !row.favorite }, favorite.dataset.meshFocus));
        const pin = element('button', `mesh-row-action${row.pinned ? ' is-pinned' : ''}`); pin.type = 'button'; pin.disabled = !editable;
        pin.innerHTML = '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3h8M7 3v5l-3 4h12l-3-4V3M10 12v5"/></svg>';
        pin.dataset.meshFocus = `pin:${row.id}`; pin.setAttribute('aria-pressed', String(row.pinned)); pin.title = `${row.pinned ? 'Unpin' : 'Pin'} ${row.name}${row.pinned ? '' : ' to the top'}`; pin.setAttribute('aria-label', pin.title);
        pin.addEventListener('click', () => void this.saveLayout({ action: 'pin', category: this.category, id: row.id, enabled: !row.pinned }, pin.dataset.meshFocus));
        actions.append(favorite, pin); wrapper.append(handle, button, actions); container.append(wrapper);
      }
    }
    if (!rows.length) container.append(element('p', 'mesh-list-empty', query ? `No matching ${this.favoritesOnly[this.category] ? 'favorite ' : ''}${this.category}.` : this.favoritesOnly[this.category] ? `No favorite ${this.category} yet. Turn off Favorites, then star an entry to add it here.` : this.data.connected ? `No ${this.category} on this node. Configure them with your existing MeshCore app, then sync here.` : `Your node’s ${this.category} will appear here.`));
    container.scrollTop = scrollTop;
    if (focusedKey) this.focusListControl(focusedKey);
  }
  renderMessages() {
    const target = this.targets().find(row => row.id === this.selected), messages = this.conversationMessages();
    $('#mesh-chat-title').textContent = target?.name || 'Your next conversation starts here';
    $('#mesh-chat-subtitle').textContent = target ? target.repeater ? `Repeater console · through ${this.data.node?.name || 'your companion node'} over LoRa` : target.channel ? 'Channel conversation · everyone with this channel key can read it' : target.writable ? 'Direct conversation · delivery receipts supported' : target.detail : 'Connect a node and select a channel or contact.';
    $('#mesh-chat-avatar').textContent = target ? target.channel ? '#' : target.name.slice(0, 1).toUpperCase() : '⌁';
    $('#mesh-chat-tag').textContent = target ? target.repeater ? 'REPEATER' : target.channel ? 'CHANNEL' : 'DIRECT' : 'MESHCORE';
    $('#mesh-messages').classList.toggle('mesh-repeater-log', Boolean(target?.repeater));
    $('#mesh-messages').setAttribute('aria-label', target?.repeater ? 'Repeater command replies' : 'Conversation messages');
    this.renderDeliveryDetails();
    const signature = `${this.selected}:${messages.map(row => `${row.id}:${row.status}:${row.delivery?.revision || 0}`).join(',')}`;
    if (signature === this.messageSignature) {
      if (this.forceScroll) this.jumpToLatest(); this.forceScroll = false;
      return;
    }
    this.messageSignature = signature;
    const container = $('#mesh-messages'), nearBottom = this.atLatestMessage(), previousScroll = container.scrollTop;
    container.replaceChildren();
    if (!messages.length) {
      const empty = element('div', 'mesh-chat-empty'); empty.append(element('div', 'mesh-empty-mark', '⌁'), element('h3', '', target?.repeater ? 'Your repeater console' : target ? 'A clear channel' : 'Stay connected beyond the network'), element('p', '', target?.repeater ? 'Log in above, then request status or send an administrator command. Replies appear here. This console is cleared when the companion disconnects.' : target ? 'No messages saved for this conversation yet. New messages will appear here.' : 'Use USB, Bluetooth, or Wi-Fi to connect your MeshCore node. Channels, contacts, and messages are read directly from it.'));
      container.append(empty);
    }
    for (const row of messages) {
      const item = element('article', `mesh-message ${row.direction === 'out' ? 'outgoing' : 'incoming'}`);
      item.append(element('div', 'mesh-message-sender', row.direction === 'out' ? target?.repeater ? 'COMMAND' : 'YOU' : row.sender || target?.name || 'Node'));
      item.append(element('p', 'mesh-message-text', row.text));
      const date = new Date((row.timestamp || 0) * 1000), meta = element('div', 'mesh-message-meta');
      meta.append(element('time', '', Number.isNaN(date.valueOf()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })));
      if (row.direction === 'out' && !target?.repeater) {
        meta.append(element('span', `mesh-delivery ${row.status}`, deliveryLabel(row)));
        const hops = deliveryHopLabel(row); if (hops) meta.append(element('span', 'mesh-delivery-hops', hops));
        const details = element('button', 'mesh-delivery-details', 'Receipt & path'); details.type = 'button'; details.setAttribute('aria-label', `View delivery receipt and path for message sent ${date.toLocaleString()}`);
        details.addEventListener('click', () => { this.deliveryMessageId = row.id; this.deliveryDialogSignature = null; this.renderDeliveryDetails(); $('#mesh-delivery-dialog').showModal(); }); meta.append(details);
      }
      else if (Number.isFinite(row.snr)) meta.append(element('span', '', `SNR ${row.snr} dB`));
      item.append(meta); if (row.error) item.title = row.error; container.append(item);
    }
    container.scrollTop = nearBottom || this.forceScroll ? container.scrollHeight : previousScroll; this.forceScroll = false;
  }
  renderComposer() {
    const target = this.targets().find(row => row.id === this.selected), enabled = this.data.connected && target?.writable;
    $('#mesh-message-form').classList.toggle('hidden', Boolean(target?.repeater));
    this.renderRepeater();
    this.maxBytes = target?.channel ? Math.max(1, Math.min(150, 160 - bytes(this.data.node?.name || '') - 2)) : 150;
    const size = bytes($('#mesh-message').value.trim());
    $('#mesh-message').disabled = !enabled || this.sending;
    $('#mesh-message').placeholder = enabled ? `Message ${target.name}… (Enter to send, Shift+Enter for a new line)` : !this.data.connected ? 'Connect your node to send a message…' : 'Select a configured channel or chat contact…';
    $('#mesh-byte-count').textContent = `${size} / ${this.maxBytes} bytes`; $('#mesh-byte-count').classList.toggle('over-limit', size > this.maxBytes);
    $('#mesh-send').disabled = !enabled || this.sending || !size || size > this.maxBytes;
    $('#mesh-send').textContent = this.sending ? 'Sending…' : 'Send ↗';
    $('#mesh-send-hint').textContent = target && !target.writable ? 'This entry is read-only. Select a chat contact or configured channel.' : target?.channel ? 'One broadcast · retries only on node send errors · recipient receipt unavailable.' : 'Up to 4 attempts · stops when the recipient ACK confirms delivery.';
  }
  renderDeliveryDetails() {
    if (!this.deliveryMessageId) return;
    const row = this.data.messages.find(message => message.id === this.deliveryMessageId), dialog = $('#mesh-delivery-dialog');
    if (!row) { if (dialog.open) dialog.close(); this.deliveryMessageId = null; return; }
    const signature = `${row.id}:${row.status}:${row.delivery?.revision || 0}`;
    if (signature === this.deliveryDialogSignature) return;
    this.deliveryDialogSignature = signature;
    const content = $('#mesh-delivery-content'), delivery = row.delivery, receipt = delivery?.receipt;
    content.replaceChildren();
    content.append(element('p', `mesh-delivery-summary ${row.status}`, deliveryLabel(row)));
    const sent = new Date(row.timestamp * 1000).toLocaleString();
    content.append(element('p', 'mesh-delivery-explainer', `Sent ${sent} · ${delivery?.destinationName || (row.recipient.startsWith('channel:') ? 'Channel ' + row.recipient.slice(8) : row.recipient.slice(8, 20))}`));
    if (row.status === 'delivered') {
      content.append(element('p', 'mesh-delivery-explainer', 'The recipient’s ACK confirms delivery to its node. This is not a read receipt.'));
      const fields = element('dl', 'mesh-delivery-receipt');
      for (const [name, value] of [['CONFIRMED', receipt?.receivedAt ? new Date(receipt.receivedAt).toLocaleString() : 'Recorded by a previous app version'], ['ROUND TRIP', Number.isFinite(receipt?.roundTripMs ?? row.roundTrip) ? `${receipt?.roundTripMs ?? row.roundTrip} ms` : 'Not reported'], ['ACK CODE', Number.isInteger(receipt?.ackCode ?? row.ack) ? '0x' + (receipt?.ackCode ?? row.ack).toString(16).padStart(8, '0') : 'Not recorded']]) {
        const field = element('div', ''); field.append(element('dt', '', name), element('dd', '', value)); fields.append(field);
      }
      content.append(fields);
    } else if (delivery?.type === 'channel' || row.recipient.startsWith('channel:')) content.append(element('p', 'mesh-delivery-explainer', 'MeshCore channels broadcast without individual recipient ACKs. Node acceptance or a relayed copy cannot prove that channel members received this message. Recipient delivery and a complete per-recipient path are unavailable.'));
    else content.append(element('p', 'mesh-delivery-explainer', 'Delivery remains unconfirmed until a matching recipient ACK arrives. A missing ACK does not prove that the message was lost.'));
    if (row.error) content.append(element('p', 'mesh-delivery-problem', row.error));
    if (receipt?.learnedRoute) this.appendDeliveryPath(content, 'Learned route near delivery', receipt.learnedRoute, delivery, false,
      'The companion reported this outbound route near the ACK. It is not an independent trace of the message’s forward path.');
    if (receipt?.ackReturnPath) this.appendDeliveryPath(content, 'Observed ACK return path', receipt.ackReturnPath, delivery, true,
      receipt.ackReturnPath.kind === 'flood-return' ? 'Relay hashes observed on the matching ACK packet returning to your companion.' : 'A routed ACK consumes its relay list while travelling. The remaining list does not reveal its full return path or hop count.');
    if (!delivery?.attempts.length) content.append(element('p', 'mesh-delivery-explainer', delivery ? 'No send attempts have started yet.' : 'This older message has no recorded attempt or path details.'));
    for (const attempt of delivery?.attempts || []) {
      const card = element('section', 'mesh-delivery-attempt');
      const states = { sending: 'Sending', accepted: 'Accepted by local node', 'awaiting-ack': 'Waiting for ACK', 'no-ack': 'No ACK in the wait window', delivered: 'Recipient ACK received', rejected: 'Local send rejected', cancelled: 'Cancelled after an earlier ACK' };
      card.append(element('h3', '', `Attempt ${attempt.number} / ${delivery.maxAttempts} · ${states[attempt.state] || attempt.state}`));
      card.append(element('p', 'mesh-delivery-explainer', `${new Date(attempt.transmittedAt || attempt.startedAt).toLocaleString()}${attempt.mode ? ' · ' + attempt.mode : ''}${attempt.acceptedAt ? ' · accepted by companion' : ''}`));
      if (attempt.error) card.append(element('p', 'mesh-delivery-problem', attempt.error));
      if (attempt.routeRecovery) card.append(element('p', 'mesh-delivery-explainer', attempt.routeRecovery));
      if (attempt.route) this.appendDeliveryPath(card, 'Outbound route at send time', attempt.route, delivery, false,
        'Captured from the companion contact immediately before sending. A receipt confirms delivery; it does not independently verify each relay identity.');
      content.append(card);
    }
    content.append(element('p', 'mesh-delivery-explainer', 'Hop counts here count relays: zero relay hops means one direct radio link. Short relay hashes can match multiple nodes; ambiguous or unknown identities are shown explicitly.'));
  }
  appendDeliveryPath(container, title, path, delivery, reverse, explanation) {
    const section = element('section', 'mesh-delivery-path'); section.append(element('h4', '', title));
    const known = Number.isInteger(path.hops), label = known ? `${path.hops} relay hops · ${path.hops + 1} radio link${path.hops ? 's' : ''}` : path.kind === 'flood' ? 'Flood broadcast · complete route not reported' : 'Complete route and hop count not reported';
    section.append(element('p', 'mesh-delivery-path-count', label));
    if (known) {
      const chain = element('ol', 'mesh-path-chain');
      chain.append(element('li', 'mesh-path-endpoint', reverse ? delivery?.destinationName || 'Recipient' : delivery?.sourceName || 'Your companion'));
      for (const node of path.nodes || []) {
        const item = element('li', 'mesh-path-relay'), matches = node.matches || [];
        item.append(element('strong', '', matches.length === 1 ? matches[0].name : matches.length > 1 ? 'Ambiguous relay' : 'Unidentified relay'));
        item.append(element('code', '', node.hash));
        if (matches.length > 1) item.append(element('small', '', `Possible matches: ${matches.map(match => match.name).join(', ')}`));
        chain.append(item);
      }
      chain.append(element('li', 'mesh-path-endpoint', reverse ? delivery?.sourceName || 'Your companion' : delivery?.destinationName || 'Recipient')); section.append(chain);
    }
    section.append(element('p', 'mesh-delivery-explainer', explanation)); container.append(section);
  }
  renderRepeater() {
    const target = this.targets().find(row => row.id === this.selected), repeater = Boolean(target?.repeater);
    $('#mesh-repeater-panel').classList.toggle('hidden', !repeater); $('#mesh-repeater-command-form').classList.toggle('hidden', !repeater);
    if (!repeater) return;
    const state = this.data.repeaters?.[target.publicKey] || {}, busy = Boolean(this.data.repeaterBusy || this.repeaterPending), authenticated = state.phase === 'authenticated';
    const canCommand = this.data.connected && authenticated && state.admin !== false && !busy;
    const encoded = Number(target.pathLength) & 255, hops = encoded & 63;
    $('#mesh-repeater-route').textContent = !Number.isFinite(target.pathLength) ? 'Route not yet reported' : encoded === 255 ? 'Flood · route discovery' : hops === 0 ? 'Direct · zero relay hops' : `${hops} relay hop${hops === 1 ? '' : 's'}`;
    $('#mesh-repeater-identity').textContent = target.publicKey;
    $('#mesh-repeater-access').textContent = authenticated ? state.admin === true ? 'ADMINISTRATOR' : state.admin === false ? 'GUEST · STATUS ONLY' : 'LEGACY LOGIN · ACCESS LEVEL NOT REPORTED' : state.phase === 'logging-in' ? 'AUTHENTICATING' : 'NOT LOGGED IN';
    $('#mesh-repeater-access').classList.toggle('authenticated', authenticated);
    $('#mesh-repeater-login').disabled = !this.data.connected || busy; $('#mesh-repeater-password').disabled = !this.data.connected || busy;
    $('#mesh-repeater-login').textContent = state.phase === 'logging-in' ? 'Logging in…' : authenticated ? 'Log in again' : 'Connect & log in';
    $('#mesh-repeater-logout').disabled = !this.data.connected || busy || !authenticated;
    $('#mesh-repeater-status').disabled = !this.data.connected || busy || !authenticated;
    $('#mesh-repeater-state').textContent = !this.data.connected ? 'Connect your companion node to log in to this repeater.' : state.error || state.notice || 'Ready to log in. Leave the password blank if this companion already has repeater ACL access.';
    $('#mesh-repeater-state').classList.toggle('error', Boolean(state.error));
    $('#mesh-repeater-command').disabled = !canCommand;
    $('#mesh-repeater-command').placeholder = authenticated && state.admin === false ? 'Guest access · administrator login required for commands' : !authenticated ? 'Log in with admin access to send commands…' : 'Enter a repeater CLI command…';
    const size = bytes($('#mesh-repeater-command').value.trim()); $('#mesh-repeater-byte-count').textContent = `${size} / 150 bytes`;
    $('#mesh-repeater-byte-count').classList.toggle('over-limit', size > 150); $('#mesh-repeater-send').disabled = !canCommand || size === 0 || size > 150;
    for (const button of document.querySelectorAll('[data-mesh-command]')) button.disabled = !canCommand;
    $('#mesh-repeater-command-hint').textContent = busy ? 'Waiting for the current repeater request…' : state.admin === false ? 'Guest login supports status requests. Use the admin password for commands.' : 'Commands and replies stay in this session only. No automatic retries.';
    const stats = state.stats, statsContainer = $('#mesh-repeater-stats'); statsContainer.classList.toggle('hidden', !stats);
    $('#mesh-repeater-status-time').textContent = stats ? `Updated ${new Date(stats.updatedAt).toLocaleTimeString()}` : 'Request status after login';
    statsContainer.replaceChildren();
    if (stats) {
      const hours = Math.floor(stats.uptimeSeconds / 3600), minutes = Math.floor(stats.uptimeSeconds % 3600 / 60);
      for (const [label, value] of [['BATTERY', stats.batteryMillivolts ? `${(stats.batteryMillivolts / 1000).toFixed(2)} V` : '—'], ['UPTIME', `${hours}h ${minutes}m`], ['LAST RSSI', `${stats.rssi} dBm`], ['LAST SNR', `${stats.snr} dB`], ['NOISE FLOOR', `${stats.noiseFloor} dBm`], ['TX QUEUE', stats.queueLength], ['PACKETS RX / TX', `${stats.packetsReceived} / ${stats.packetsSent}`], ['ERROR FLAGS', `0x${stats.errorFlags.toString(16)}`]]) {
        const cell = element('div', ''); cell.append(element('dt', '', label), element('dd', '', String(value))); statsContainer.append(cell);
      }
    }
  }
  async repeaterAction(action) {
    const target = this.targets().find(row => row.id === this.selected);
    if (!target?.repeater || !this.data.connected || this.repeaterPending || this.data.repeaterBusy) return;
    const node = this.data.node.publicKey, connectionId = this.data.connectionId, input = { node, publicKey: target.publicKey, action };
    if (action === 'login') { input.password = $('#mesh-repeater-password').value; $('#mesh-repeater-password').value = ''; }
    if (action === 'command') { input.command = $('#mesh-repeater-command').value; $('#mesh-repeater-command').value = ''; }
    this.repeaterPending = true; this.renderRepeater();
    try {
      const result = await this.api('/api/meshcore/repeater', input);
      if (result.node === this.data.node?.publicKey && result.connectionId === this.data.connectionId) {
        const existing = this.data.repeaters?.[result.publicKey];
        if (!existing || result.repeater.revision >= existing.revision) this.data = { ...this.data, repeaters: { ...this.data.repeaters, [result.publicKey]: result.repeater } };
        if (this.data.repeaterBusy?.id === result.operationId) this.data = { ...this.data, repeaterBusy: null };
      }
    } catch (error) {
      if (node === this.data.node?.publicKey && connectionId === this.data.connectionId) this.toast(error.message, 'error');
    } finally { this.repeaterPending = false; this.renderMessages(); this.renderRepeater(); }
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
