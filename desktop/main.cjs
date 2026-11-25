const { app, BrowserWindow, ipcMain, globalShortcut, safeStorage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const preferences = path.join(app.getPath('userData'), 'display.json')
const page = path.join(__dirname, '../dist/index.html')
if (process.platform === 'win32') app.setAppUserModelId('io.github.suyh1.readbox')
const shortcutFile = path.join(app.getPath('userData'), 'shortcut.json')
const davFile = path.join(app.getPath('userData'), 'webdav.json')
function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 })
  fs.renameSync(file + '.tmp', file)
}

let accelerator = 'F8'
let registered = ''
try {
  accelerator = JSON.parse(fs.readFileSync(shortcutFile, 'utf8')).shortcut
} catch { /* First launch uses the default. */ }

function showWindow() {
  if (window?.isMinimized()) window.restore()
  window?.show()
  window?.focus()
}
function registerShortcut(key) {
  return globalShortcut.register(key, () => {
    if (window?.isVisible() && !window.isMinimized()) window.hide()
    else showWindow()
  })
}
function setShortcut(key) {
  if (typeof key !== 'string' || (key && !/^(?:(?:Control|Alt|Shift|Super)\+)*(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)$/.test(key))) {
    throw new Error('请选择有效的老板键')
  }
  if (key !== registered && key && !registerShortcut(key)) throw new Error('快捷键已被占用或系统不支持')
  try {
    saveJson(shortcutFile, { shortcut: key })
  } catch (error) {
    if (key && key !== registered) globalShortcut.unregister(key)
    throw error
  }
  if (registered && registered !== key) globalShortcut.unregister(registered)
  registered = accelerator = key
  return { key, active: !!registered }
}

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

if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland') {
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
}

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

function isReadingWindowActive() {
  return !!window && window.isVisible() && !window.isMinimized() && window.isFocused()
}

function openWindow() {
  window = new BrowserWindow({
    width: 960, height: 680, autoHideMenuBar: true,
    icon: path.join(__dirname, 'icons/readbox.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
    },
  })
  for (const event of ['hide', 'minimize', 'blur']) {
    window.on(event, () => window.webContents.send('window:activity', false))
  }
  for (const event of ['show', 'restore', 'focus']) {
    window.on(event, () => window.webContents.send('window:activity', isReadingWindowActive()))
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.on('closed', () => { window = null })
  return window.loadFile(page)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('will-quit', () => globalShortcut.unregisterAll())
  ipcMain.handle('window:active', event => { checkCaller(event); return isReadingWindowActive() })
  ipcMain.handle('shortcut:read', event => {
    checkCaller(event)
    return { key: accelerator, active: !!registered }
  })
  ipcMain.handle('shortcut:write', (event, key) => { checkCaller(event); return setShortcut(key) })
  ipcMain.handle('dav:read', event => {
    checkCaller(event)
    if (!fs.existsSync(davFile)) return null
    const config = JSON.parse(fs.readFileSync(davFile, 'utf8'))
    if (config.encrypted) config.password = safeStorage.decryptString(Buffer.from(config.password, 'base64'))
    return config
  })
  ipcMain.handle('dav:save', (event, config) => {
    checkCaller(event)
    if (!config) { fs.rmSync(davFile, { force: true }); return }
    const encrypted = safeStorage.isEncryptionAvailable()
    saveJson(davFile, { ...config, encrypted,
      password: encrypted ? safeStorage.encryptString(config.password).toString('base64') : config.password })
  })
  ipcMain.handle('dav:request', async (event, config, id, write) => {
    checkCaller(event)
    return (await import('./webdav.mjs')).requestProgress(config, id, write)
  })
  ipcMain.handle('dav:probe', async (event, config) => {
    checkCaller(event)
    return (await import('./webdav.mjs')).probeDirectory(config)
  })
  ipcMain.handle('display:read', event => { checkCaller(event); return rendering() })
  ipcMain.handle('display:write', (event, enabled) => {
    checkCaller(event)
    if (typeof enabled !== 'boolean') throw new TypeError('无效的显示设置')
    saveJson(preferences, { hardwareAcceleration: enabled })
    hardwareRequested = enabled
    return rendering()
  })
  app.whenReady().then(() => {
    try { if (accelerator && registerShortcut(accelerator)) registered = accelerator } catch { /* Configurable in settings. */ }
    return openWindow()
  }).catch(error => { console.error(error); app.exit(1) })
  app.on('window-all-closed', () => app.quit())
}
