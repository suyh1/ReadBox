const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('readbox', {
  rendering: () => ipcRenderer.invoke('display:read'),
  setHardwareAcceleration: enabled => ipcRenderer.invoke('display:write', enabled),
})
