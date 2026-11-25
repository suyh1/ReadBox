const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('readbox', {
  onWindowActivity: callback => {
    let received = false
    const listener = (_event, active) => { received = true; callback(active) }
    ipcRenderer.on('window:activity', listener)
    ipcRenderer.invoke('window:active').then(active => { if (!received) callback(active) })
    return () => { received = true; ipcRenderer.removeListener('window:activity', listener) }
  },
  shortcut: () => ipcRenderer.invoke('shortcut:read'),
  setShortcut: key => ipcRenderer.invoke('shortcut:write', key),
  davSettings: () => ipcRenderer.invoke('dav:read'),
  saveDavSettings: config => ipcRenderer.invoke('dav:save', config),
  probeDirectory: config => ipcRenderer.invoke('dav:probe', config),
  requestProgress: (config, id, write) => ipcRenderer.invoke('dav:request', config, id, write),
  rendering: () => ipcRenderer.invoke('display:read'),
  setHardwareAcceleration: enabled => ipcRenderer.invoke('display:write', enabled),
})
