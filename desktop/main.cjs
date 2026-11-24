const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const preferences = path.join(app.getPath('userData'), 'display.json')
const page = path.join(__dirname, '../dist/index.html')
let hardwareRequested = false
try {
  hardwareRequested = JSON.parse(fs.readFileSync(preferences, 'utf8')).hardwareAcceleration === true
} catch (error) {
  if (error.code !== 'ENOENT') console.warn('无法读取显示设置，使用软件绘制')
}
const startupPreference = hardwareRequested
const forceSoftware = app.commandLine.hasSwitch('disable-gpu')
if (!startupPreference || forceSoftware) app.disableHardwareAcceleration()
if (process.platform === 'linux' && process.arch === 'arm64') app.commandLine.appendSwitch('ozone-platform', 'x11')

let window
async function rendering() {
  let gpuCompositing = false
  if (startupPreference && !forceSoftware) {
    try {
      await app.getGPUInfo('basic')
      gpuCompositing = app.getGPUFeatureStatus().gpu_compositing === 'enabled'
    } catch {
      // A driver can refuse GPU access even when the user requested it.
    }
  }
  return {
    hardwareRequested, forceSoftware,
    restartRequired: hardwareRequested !== startupPreference,
    gpuCompositing,
  }
}

function checkCaller(event) {
  if (!window || event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== pathToFileURL(page).href) throw new Error('无效的设置请求')
}

function openWindow() {
  window = new BrowserWindow({
    width: 960, height: 680, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.on('closed', () => { window = null })
  return window.loadFile(page)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  ipcMain.handle('display:read', event => { checkCaller(event); return rendering() })
  ipcMain.handle('display:write', (event, enabled) => {
    checkCaller(event)
    if (typeof enabled !== 'boolean') throw new TypeError('无效的显示设置')
    fs.mkdirSync(path.dirname(preferences), { recursive: true })
    fs.writeFileSync(preferences + '.tmp', JSON.stringify({ hardwareAcceleration: enabled }), { mode: 0o600 })
    fs.renameSync(preferences + '.tmp', preferences)
    hardwareRequested = enabled
    return rendering()
  })
  app.whenReady().then(openWindow).catch(error => { console.error(error); app.exit(1) })
  app.on('window-all-closed', () => app.quit())
}
