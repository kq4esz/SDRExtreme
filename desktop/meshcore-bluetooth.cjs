const { ipcMain } = require('electron');

// Device selection and PIN approval always come from the user in the local UI.
module.exports = function setupBluetooth({ window, trusted }) {
  let armedUntil = 0, selection, pairing, selectionTimer, pairingTimer;
  let devices = new Map();
  const send = (type, data) => { if (!window.isDestroyed()) window.webContents.send(type, data); };
  function cancelSelection() {
    const callback = selection; selection = null; clearTimeout(selectionTimer); selectionTimer = null; devices.clear();
    callback?.(''); send('mesh:devices', { closed: true, devices: [] });
  }
  function cancelPairing() {
    const callback = pairing; pairing = null; clearTimeout(pairingTimer); pairingTimer = null;
    callback?.({ confirmed: false }); send('mesh:pairing', { closed: true });
  }
  const arm = event => { if (trusted(event)) { cancelSelection(); cancelPairing(); armedUntil = Date.now() + 90000; } };
  const choose = (event, id) => {
    if (!trusted(event)) return;
    if (!id) { cancelSelection(); armedUntil = 0; return; }
    if (!selection || !devices.has(id)) return;
    armedUntil = Date.now() + 90000;
    const callback = selection; selection = null; clearTimeout(selectionTimer); selectionTimer = null; devices.clear();
    send('mesh:devices', { closed: true, devices: [] }); callback(id);
  };
  const respond = (event, response) => {
    if (!trusted(event) || !pairing) return;
    const callback = pairing; pairing = null; clearTimeout(pairingTimer); pairingTimer = null;
    const pin = typeof response?.pin === 'string' ? response.pin : '';
    callback({ confirmed: response?.confirmed === true, ...(pin && /^[a-z0-9]{1,16}$/i.test(pin) ? { pin } : {}) });
    send('mesh:pairing', { closed: true });
  };
  ipcMain.on('mesh:arm', arm); ipcMain.on('mesh:choose', choose); ipcMain.on('mesh:pair-response', respond);
  window.webContents.on('select-bluetooth-device', (event, list, callback) => {
    event.preventDefault();
    if (Date.now() > armedUntil || !window.webContents.getURL().startsWith('http://127.0.0.1:')) { callback(''); return; }
    selection = callback;
    for (const device of list) devices.set(device.deviceId, device);
    send('mesh:devices', { devices: [...devices.values()].map(device => ({ id: device.deviceId, name: device.deviceName || 'Unnamed MeshCore device' })) });
    if (!selectionTimer) selectionTimer = setTimeout(() => { cancelSelection(); armedUntil = 0; }, 60000);
  });
  window.webContents.session.setBluetoothPairingHandler((details, callback) => {
    if (Date.now() > armedUntil || window.isDestroyed()) { callback({ confirmed: false }); return; }
    cancelPairing(); pairing = callback;
    send('mesh:pairing', { kind: details.pairingKind, device: details.deviceId, pin: details.pin || '' });
    pairingTimer = setTimeout(cancelPairing, 60000);
  });
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) { cancelSelection(); cancelPairing(); armedUntil = 0; } });
  window.on('closed', () => {
    cancelSelection(); cancelPairing(); armedUntil = 0;
    ipcMain.removeListener('mesh:arm', arm); ipcMain.removeListener('mesh:choose', choose); ipcMain.removeListener('mesh:pair-response', respond);
  });
};
