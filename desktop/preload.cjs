const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('sdrDesktop', {
    selectRtlLibrary: () => ipcRenderer.invoke('sdr:choose-library'),
    openReceiver: id => ipcRenderer.invoke('sdr:open-receiver', id),
    onNavigate: callback => { const listener = (_event, page) => callback(page); ipcRenderer.on('sdr:navigate', listener); return () => ipcRenderer.removeListener('sdr:navigate', listener); }
  });
}
