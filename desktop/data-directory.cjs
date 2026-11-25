const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

// Only migrate storage used by the reader. Chromium caches and instance locks
// are recreated; Electron's userData stays fixed for the single-instance lock.
const entries = ['IndexedDB', 'Local Storage', 'WebStorage', 'display.json', 'shortcut.json', 'webdav.json']
const marker = '.readbox-library-id'

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600, flush: true })
  fs.renameSync(file + '.tmp', file)
}

function inside(parent, child) {
  const rel = path.relative(parent, child)
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep))
}

function copyData(source, target, id) {
  const staging = path.join(path.dirname(target), '.readbox-migration-' + id)
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('迁移记录无效。')
  // Discard an interrupted copy for this journal entry before retrying.
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { mode: 0o700 })
  try {
    // Local State carries Chromium's wrapped key for WebDAV credentials.
    // Keep the original key in the bootstrap profile as well.
    for (const name of [...entries, 'Local State']) {
      const from = path.join(source, name)
      if (!fs.lstatSync(from, { throwIfNoEntry: false })) continue
      fs.cpSync(from, path.join(staging, name), {
        recursive: true,
        filter(file) {
          if (fs.lstatSync(file).isSymbolicLink()) throw new Error('数据目录包含符号链接：' + file)
          return true
        },
      })
    }
    fs.writeFileSync(path.join(staging, marker), id, { mode: 0o600, flush: true })
    fs.renameSync(staging, target)
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

function dataDirectory(defaultDir) {
  const locator = path.join(defaultDir, 'data-location.json')
  let state = {}
  try {
    state = JSON.parse(fs.readFileSync(locator, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('无法读取数据目录配置：' + locator, { cause: error })
  }
  let current = state.active?.dir ?? defaultDir
  if (state.active) {
    try {
      if (fs.readFileSync(path.join(current, marker), 'utf8') !== state.active.id) throw Error()
      fs.accessSync(current, fs.constants.W_OK)
    } catch {
      throw new Error('请重新连接存储设备，或恢复数据目录的访问权限后启动 ReadBox。\n' + current)
    }
  }

  function destination(parent) {
    const dir = path.join(fs.realpathSync(parent), 'ReadBox')
    for (const root of [defaultDir, current]) {
      const real = fs.realpathSync(root)
      if (inside(real, dir) || inside(dir, real)) throw new Error('请选择与现有 ReadBox 数据目录分开的位置。')
    }
    if (fs.lstatSync(dir, { throwIfNoEntry: false })) throw new Error('所选位置已包含 ReadBox 文件夹，请另选位置。')
    fs.accessSync(path.dirname(dir), fs.constants.W_OK)
    return dir
  }

  function schedule(parent) {
    const dir = destination(parent)
    saveJson(locator, { active: state.active, pending: { dir, id: randomUUID() } })
  }

  let notice = ''
  if (state.pending) {
    const { dir, id } = state.pending
    const previous = current
    // A restart after publishing the copy but before committing the locator
    // can finish the same migration by recognizing its completed marker.
    try {
      if (fs.lstatSync(dir, { throwIfNoEntry: false })) {
        if (fs.readFileSync(path.join(dir, marker), 'utf8') !== id) throw new Error('目标目录已被占用。')
      } else {
        if (dir !== destination(path.dirname(dir))) throw new Error('目标目录的位置已改变。')
        copyData(current, dir, id)
      }
      saveJson(locator, { active: { dir, id } })
      state.active = { dir, id }
      current = dir
    } catch (error) {
      saveJson(locator, { active: state.active })
      notice = '数据迁移失败，仍使用原目录。\n' + previous + '\n\n' + error.message
    }
    if (current !== previous) {
      try {
        for (const name of entries) fs.rmSync(path.join(previous, name), { recursive: true, force: true })
      } catch {
        notice = '数据已迁移。旧目录中的部分副本未能清理：\n' + previous
      }
    }
  }
  return { current, notice, destination, schedule }
}

module.exports = { dataDirectory, saveJson }
