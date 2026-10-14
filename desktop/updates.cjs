const fs = require('node:fs');
const path = require('node:path');
const { app, dialog } = require('electron');

function createUpdates({ getWindow, dataDir, beforeInstall, onStatus = () => {} }) {
  let updater, ready = false, busy, timer, initialTimer, disposed = false;
  let status = { phase: app.isPackaged ? 'idle' : 'development', version: app.getVersion() };
  const logFile = path.join(dataDir, 'updates.log');
  const writeLog = (level, ...values) => {
    try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${level} ${values.map(value => value instanceof Error ? value.message : String(value)).join(' ')}\n`); } catch {}
  };
  const change = next => {
    status = { ...status, ...next, checkedAt: new Date().toISOString() };
    try { fs.writeFileSync(path.join(dataDir, 'updates.json'), JSON.stringify(status, null, 2)); } catch {}
    onStatus(status);
  };
  const message = options => {
    const parent = getWindow();
    return parent && !parent.isDestroyed() ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
  };
  async function install() {
    if (!ready || disposed) return;
    stopTimers();
    await beforeInstall();
    updater.quitAndInstall(false, true);
  }
  async function check(manual = false) {
    if (!app.isPackaged) {
      if (manual) await message({ type: 'info', title: 'SDR Extreme updates', message: 'Automatic updates run in the installed Windows application.', detail: 'Install the Windows setup executable from GitHub Releases.' });
      return;
    }
    if (disposed) return;
    if (ready) {
      if (manual) {
        const result = await message({ type: 'info', title: 'Update ready', message: `SDR Extreme ${status.availableVersion} is ready to install.`, detail: 'The receiver will stop before restarting. Memories and settings are preserved. You can also close the app normally to install the update.', buttons: ['Restart and install', 'Later'], defaultId: 1, cancelId: 1 });
        if (result.response === 0) await install();
      }
      return;
    }
    if (status.phase === 'downloading') {
      if (manual) await message({ type: 'info', title: 'Downloading update', message: `Downloading SDR Extreme ${status.availableVersion}`, detail: `${Math.floor(status.percent || 0)}% complete. You can keep listening while the update downloads.` });
      return;
    }
    if (busy) return busy;
    busy = (async () => {
      try {
        await updater.checkForUpdates();
        if (manual && status.phase === 'current') await message({ type: 'info', title: 'SDR Extreme updates', message: `SDR Extreme ${app.getVersion()} is up to date.` });
        else if (manual && status.phase === 'downloading') await message({ type: 'info', title: 'Update available', message: `Downloading SDR Extreme ${status.availableVersion}`, detail: 'The update will install after you close the app, or when you choose Restart to install update in Help.' });
      } catch (error) {
        change({ phase: 'error', error: error.message });
        if (manual) await message({ type: 'warning', title: 'Update check failed', message: 'Could not check for updates.', detail: `${error.message}\n\nYour installed receiver remains available. The app will try again automatically.` });
      } finally { busy = null; }
    })();
    return busy;
  }
  function stopTimers() { clearInterval(timer); clearTimeout(initialTimer); }
  function start() {
    if (!app.isPackaged) return;
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, (...values) => writeLog(level, ...values)]));
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.on('checking-for-update', () => change({ phase: 'checking', error: null }));
    updater.on('update-not-available', () => change({ phase: 'current', error: null }));
    updater.on('update-available', info => change({ phase: 'downloading', availableVersion: info.version, percent: 0, error: null }));
    updater.on('download-progress', progress => change({ phase: 'downloading', percent: Math.round(progress.percent) }));
    updater.on('error', error => { writeLog('error', error); change({ phase: 'error', error: error.message }); });
    updater.on('update-downloaded', info => {
      ready = true;
      change({ phase: 'ready', availableVersion: info.version, percent: 100, error: null });
    });
    initialTimer = setTimeout(() => { void check(); }, 15000);
    timer = setInterval(() => { void check(); }, 4 * 60 * 60 * 1000);
    initialTimer.unref(); timer.unref();
    change({ phase: 'idle' });
  }
  return { start, check, install, snapshot: () => ({ ...status }), dispose: () => { disposed = true; stopTimers(); } };
}

module.exports = { createUpdates };
