const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('sdrDesktop', {
    selectRtlLibrary: () => ipcRenderer.invoke('sdr:choose-library'),
    openReceiver: id => ipcRenderer.invoke('sdr:open-receiver', id),
    armMeshBluetooth: () => ipcRenderer.send('mesh:arm'),
    selectMeshBluetoothDevice: id => ipcRenderer.send('mesh:choose', id),
    respondMeshBluetoothPairing: response => ipcRenderer.send('mesh:pair-response', response),
    onMeshBluetoothDevices: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('mesh:devices', listener); return () => ipcRenderer.removeListener('mesh:devices', listener); },
    onMeshBluetoothPairing: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('mesh:pairing', listener); return () => ipcRenderer.removeListener('mesh:pairing', listener); },
    onNavigate: callback => { const listener = (_event, page) => callback(page); ipcRenderer.on('sdr:navigate', listener); return () => ipcRenderer.removeListener('sdr:navigate', listener); }
  });
}
