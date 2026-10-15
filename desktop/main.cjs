const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createUpdates } = require('./updates.cjs');
const setupBluetooth = require('./meshcore-bluetooth.cjs');

const ROOT = path.resolve(__dirname, '..');
const APP_VERSION = require('../package.json').version;
app.setName('SDR Extreme');
if (app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'SDR Extreme'));
if (process.env.SDREXTREME_PROFILE) { const profile = path.resolve(process.env.SDREXTREME_PROFILE); fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile); }
const DATA_DIR = path.resolve(process.env.SDREXTREME_DATA_DIR || (app.isPackaged ? path.join(app.getPath('userData'), 'data') : path.join(ROOT, 'local-data')));
const DATA_PROFILE = createHash('sha256').update(DATA_DIR.toLowerCase()).digest('hex').slice(0, 16);
const PORT = Number(process.env.SDREXTREME_PORT || 17890);
const LOCAL = `http://127.0.0.1:${PORT}`;
let window, backend, updates, quitting = false, shutdownPromise;
const receiverWindows = new Set();
app.setAppUserModelId('com.sdrextreme.desktop');

function webUrl(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; } }
function trusted(event) { return window && event.sender === window.webContents && event.senderFrame?.url.startsWith(LOCAL + '/'); }
function external(value) { const url = webUrl(value); if (url) shell.openExternal(url.toString()); }

async function state() {
  try { const response = await fetch(LOCAL + '/api/state', { signal: AbortSignal.timeout(800) }); if (response.ok) return response.json(); } catch {}
  return null;
}

async function startBackend() {
  const current = await state();
  if (current?.status?.transport === 'USB' && current.status.appVersion === APP_VERSION && current.status.dataProfile === DATA_PROFILE) return;
  if (current?.status?.host && Array.isArray(current.channels)) {
    await fetch(LOCAL + '/api/shutdown', { method: 'POST', signal: AbortSignal.timeout(2000) }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const log = fs.openSync(path.join(DATA_DIR, 'desktop.log'), 'a');
  backend = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SDREXTREME_PORT: String(PORT), SDREXTREME_DATA_DIR: DATA_DIR }, stdio: ['ignore', log, log]
  });
  fs.closeSync(log);
  let launchError;
  backend.once('error', error => { launchError = error; });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (launchError) throw launchError;
    const started = await state();
    if (started?.status?.transport === 'USB' && started.status.appVersion === APP_VERSION && started.status.dataProfile === DATA_PROFILE) return;
    if (backend.exitCode !== null) throw new Error(`The receiver service stopped. See ${path.join(DATA_DIR, 'desktop.log')}.`);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('The receiver service did not become ready. Close other instances and try again.');
}

function openReceiver(url) {
  const receiver = new BrowserWindow({ width: 1360, height: 900, minWidth: 900, minHeight: 600, title: 'KiwiSDR · SDR Extreme', backgroundColor: '#0a1018', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, partition: 'persist:kiwi-receivers' } });
  receiver.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  receiver.webContents.setWindowOpenHandler(({ url: target }) => { external(target); return { action: 'deny' }; });
  receiver.on('closed', () => receiverWindows.delete(receiver)); receiverWindows.add(receiver);
  receiver.loadURL(url); return true;
}

function createWindow() {
  let bounds = {};
  try { bounds = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'window.json'), 'utf8')); } catch {}
  window = new BrowserWindow({ width: bounds.width || 1520, height: bounds.height || 980, minWidth: 1000, minHeight: 700,
    title: 'SDR Extreme', backgroundColor: '#0a1018', show: false, icon: path.join(ROOT, 'assets', 'app-icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false } });
  window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(LOCAL + '/')) { event.preventDefault(); external(url); } });
  window.webContents.on('page-title-updated', event => event.preventDefault());
  window.once('ready-to-show', () => { if (!process.env.SDREXTREME_TEST_MODE) window.show(); });
  window.on('close', () => { if (!window.isMaximized()) fs.writeFileSync(path.join(DATA_DIR, 'window.json'), JSON.stringify(window.getBounds())); });
  window.on('closed', () => { window = null; });
  setupBluetooth({ window, trusted });
  window.loadURL(LOCAL);
  const navigate = page => { if (window) { window.show(); window.webContents.send('sdr:navigate', page); } };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'SDR Extreme', submenu: [{ label: 'Live radio', accelerator: 'Ctrl+1', click: () => navigate('radio') }, { label: 'Memory channels', accelerator: 'Ctrl+2', click: () => navigate('channels') }, { label: 'KiwiSDR map', accelerator: 'Ctrl+3', click: () => navigate('remote') }, { label: 'Decoders', accelerator: 'Ctrl+4', click: () => navigate('decoders') }, { type: 'separator' }, { label: 'Hardware settings', accelerator: 'Ctrl+,', click: () => navigate('settings') }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'MeshCore', submenu: [{ label: 'Open MeshCore client', accelerator: 'Ctrl+5', click: () => navigate('meshcore') }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { label: 'Help', submenu: [
      { label: 'Check for updates…', click: () => { void updates?.check(true); } },
      { id: 'install-update', label: 'Restart to install update', enabled: false, click: () => { void updates?.check(true); } },
      { type: 'separator' },
      { label: 'Releases on GitHub', click: () => external('https://github.com/kq4esz/SDRExtreme/releases') },
      { label: 'Open saved data folder', click: () => shell.openPath(DATA_DIR) },
      { label: 'Setup guide', click: () => shell.openPath(path.join(ROOT, 'README.md')) },
      { label: 'About SDR Extreme', click: () => dialog.showMessageBox(window, { title: 'SDR Extreme', message: `SDR Extreme ${APP_VERSION}`, detail: 'Windows receiver suite · RTL-SDR direct USB · HD Radio · KiwiSDR network atlas\nUpdates: github.com/kq4esz/SDRExtreme', type: 'info' }) }
    ] }
  ]));
}

ipcMain.handle('sdr:choose-library', async event => {
  if (!trusted(event)) throw new Error('Unavailable outside the SDR Extreme window.');
  const result = await dialog.showOpenDialog(window, { title: 'Select RTL-SDR native driver library', properties: ['openFile'], filters: [{ name: 'RTL-SDR library', extensions: ['dll'] }] });
  return result.canceled ? null : result.filePaths[0];
});

async function stopBackend() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    for (const receiver of receiverWindows) receiver.destroy();
    const endpoints = backend ? ['/api/shutdown'] : ['/api/hd/stop', '/api/rtl/stop', '/api/digital/stop', '/api/wsjt/stop', '/api/meshcore/disconnect'];
    await Promise.allSettled(endpoints.map(endpoint => fetch(LOCAL + endpoint, { method: 'POST', signal: AbortSignal.timeout(5000) })));
    if (backend && backend.exitCode === null) {
      await Promise.race([new Promise(resolve => backend.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1500))]);
      if (backend.exitCode === null) backend.kill();
    }
  })();
  return shutdownPromise;
}
ipcMain.handle('sdr:open-receiver', async (event, id) => {
  if (!trusted(event) || typeof id !== 'string' || !/^[a-f0-9]{20}$/.test(id)) throw new Error('Select a receiver from the map.');
  const response = await fetch(LOCAL + '/api/kiwi/receivers');
  const directory = await response.json();
  const receiver = directory.receivers?.find(row => row.id === id);
  if (!receiver || !webUrl(receiver.url)) throw new Error('Receiver not found in the directory.');
  return openReceiver(receiver.url);
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    session.defaultSession.setUserAgent(`${session.defaultSession.getUserAgent()} SDRExtreme/${APP_VERSION}`);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      const local = contents === window?.webContents && details.requestingUrl?.startsWith(LOCAL + '/');
      callback(Boolean(local && ['speaker-selection', 'audio-output', 'bluetooth'].includes(permission)));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => Boolean(contents === window?.webContents && (origin === LOCAL || origin === LOCAL + '/') && ['speaker-selection', 'audio-output', 'bluetooth'].includes(permission)));
    try {
      await startBackend(); createWindow();
      updates = createUpdates({ getWindow: () => window, dataDir: DATA_DIR,
        beforeInstall: async () => { await stopBackend(); quitting = true; },
        onStatus: status => {
          const item = Menu.getApplicationMenu()?.getMenuItemById('install-update');
          if (item) item.enabled = status.phase === 'ready';
        } });
      updates.start();
    }
    catch (error) { dialog.showErrorBox('SDR Extreme could not start', error.message); app.quit(); }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting) return; event.preventDefault(); quitting = true;
    updates?.dispose();
    stopBackend().finally(() => app.quit());
  });
}
