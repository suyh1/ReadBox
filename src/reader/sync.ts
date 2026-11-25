import { ref, shallowRef } from 'vue'
import { normalizeDirectory, probeDirectory, requestProgress, type DavConfig, type Position } from '../../desktop/webdav.mjs'
import { listBooks, updateBook } from './library'

const storageKey = 'readbox-webdav'
export const defaultConfig: DavConfig = {
  url: '', username: '', password: '', auto: true, rule: 'both', intervalSeconds: 3,
}
export const davConfig = shallowRef<DavConfig | null>(null)
export const syncMessage = ref('')
export const syncing = ref(false)
const desktop = window.readbox
let timer: number | undefined
let running: Promise<void> | undefined

const configReady = (async () => {
  try {
    const saved = desktop ? await desktop.davSettings() : JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (saved) davConfig.value = { ...defaultConfig, ...saved }
  } catch {
    syncMessage.value = '无法读取 WebDAV 设置，请重新配置。'
  }
})()

function connectionConfig(input: DavConfig) {
  const value = { ...input, url: normalizeDirectory(input.url.trim()), username: input.username.trim() }
  if (!value.username || value.username.includes(':') || !value.password) {
    throw new Error('请输入有效的用户名和应用密码。')
  }
  return value
}

export async function testConnection(input: DavConfig) {
  const value = connectionConfig(input)
  const status = await (desktop?.probeDirectory ?? probeDirectory)(value)
  if (status === 404) throw new Error('WebDAV 目录不存在，请核对地址。首次上传会创建缺少的子目录。')
  checkResponse(status)
}

export async function saveConfig(input: DavConfig | null) {
  await configReady
  const value = input && connectionConfig(input)
  if (value && (!Number.isInteger(value.intervalSeconds) || value.intervalSeconds < 1 || value.intervalSeconds > 3600)) {
    if (value.auto && value.rule !== 'leave') throw new Error('请输入 1 至 3600 秒的上传间隔。')
    value.intervalSeconds = davConfig.value?.intervalSeconds ?? defaultConfig.intervalSeconds
  }
  if (desktop) await desktop.saveDavSettings(value)
  else if (value) localStorage.setItem(storageKey, JSON.stringify(value))
  else localStorage.removeItem(storageKey)
  davConfig.value = value
  clearTimeout(timer)
  timer = undefined
  syncMessage.value = value ? '同步设置已保存。' : '已清除本机同步配置。'
  scheduleUpload()
}

function checkResponse(status: number) {
  if (status >= 200 && status < 300) return
  if (status === 401 || status === 403) throw new Error('WebDAV 拒绝访问，请检查用户名、应用密码和目录权限。')
  if (status === 409) throw new Error('WebDAV 目录冲突（HTTP 409），请检查 ReadBox 路径是否被同名文件占用，以及目录的写入权限。')
  if (status === 429) throw new Error('WebDAV 请求过于频繁，请稍后重试。')
  throw new Error('WebDAV 返回 HTTP ' + status)
}
const request = desktop?.requestProgress ?? requestProgress
async function download(config: DavConfig, id: string) {
  const response = await request(config, id)
  if (response.status === 404) return { ...response, position: null }
  checkResponse(response.status)
  let position: Position
  try {
    position = JSON.parse(response.body)
    if (position.id !== id || typeof position.cfi !== 'string' || !/^epubcfi\(.+\)$/.test(position.cfi) ||
        typeof position.chapter !== 'string' || !Number.isFinite(position.progress) ||
        position.progress < 0 || position.progress > 100 || !Number.isSafeInteger(position.updated) ||
        position.updated <= 0) throw new Error()
  } catch {
    throw new Error('云端进度文件无效。')
  }
  return { ...response, position }
}

async function uploadPosition(config: DavConfig, local: Position) {
  const remote = await download(config, local.id)
  if (davConfig.value !== config) return false
  const uploaded = !remote.position || local.updated > remote.position.updated
  if (uploaded) {
    const etag = remote.etag?.startsWith('W/') ? null : remote.etag
    if (remote.position && !etag && !remote.modified) throw new Error('服务器未提供进度版本，无法安全更新。')
    const response = await request(config, local.id, { position: local, etag, modified: remote.modified })
    if (response.status === 412) throw new Error('另一台设备刚更新了进度，请重试。')
    checkResponse(response.status)
  }
  await updateBook(local.id, b => {
    if (davConfig.value === config && b.pendingPosition?.updated === local.updated && b.pendingPosition.cfi === local.cfi) {
      delete b.pendingPosition
    }
  })
  return uploaded
}

export async function openingPosition(id: string, pending?: Position) {
  await configReady
  const config = davConfig.value
  if (!config) return null
  const remote = (await download(config, id)).position
  if (config.auto && pending && (!remote || pending.updated > remote.updated)) return pending
  return remote
}

async function uploadPending(config: DavConfig, manual: boolean) {
  let count = 0
  const failures: string[] = []
  const books = await listBooks()
  if (!manual && !books.some(book => book.pendingPosition)) return
  for (const book of books) {
    if (davConfig.value !== config) return
    if (!book.pendingPosition) continue
    try {
      if (await uploadPosition(config, book.pendingPosition)) count++
    } catch (error) {
      failures.push(book.title + ' · ' + syncError(error))
    }
  }
  if (davConfig.value !== config) return
  if (failures.length) throw new Error(failures.join('；'))
  syncMessage.value = count ? '已上传 ' + count + ' 本书的阅读进度。' : '阅读进度已是最新。'
}

export function syncError(error: unknown) {
  return error instanceof Error && /WebDAV|进度|服务器|设备|请输入/.test(error.message)
    ? error.message : '无法连接 WebDAV，请检查网络和目录地址。'
}

export function syncNow(manual = true): Promise<void> {
  if (running) return running
  const config = davConfig.value
  if (!config) return Promise.resolve()
  syncing.value = true
  running = uploadPending(config, manual).catch(error => {
    syncMessage.value = syncError(error)
    if (davConfig.value === config && config.auto) queueUpload(config, 60000)
  }).finally(() => {
    syncing.value = false
    running = undefined
  })
  return running
}

function queueUpload(config: DavConfig, delay: number) {
  if (timer !== undefined) {
    if (delay !== 0) return
    clearTimeout(timer)
  }
  timer = window.setTimeout(async () => {
    timer = undefined
    if (running) await running
    if (davConfig.value === config) await syncNow(false)
  }, delay)
}
export function scheduleUpload(trigger: 'interval' | 'leave' = 'interval') {
  const config = davConfig.value
  if (!config?.auto || (config.rule !== 'both' && config.rule !== trigger)) return
  queueUpload(config, trigger === 'leave' ? 0 : config.intervalSeconds * 1000)
}
void configReady.then(() => scheduleUpload())
window.addEventListener('online', () => scheduleUpload())
