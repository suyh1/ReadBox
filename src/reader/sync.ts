import { ref, shallowRef } from 'vue'
import { normalizeDirectory, requestProgress, type DavConfig, type Position } from '../../desktop/webdav.mjs'
import { listBooks, updateBook } from './library'

const storageKey = 'readbox-webdav'
export const davConfig = shallowRef<DavConfig | null>(null)
export const syncMessage = ref('')
export const syncing = ref(false)
const desktop = window.readbox
let timer: number | undefined
let running: Promise<void> | undefined

const configReady = (async () => {
  try {
    davConfig.value = desktop ? await desktop.davSettings() : JSON.parse(localStorage.getItem(storageKey) || 'null')
  } catch {
    syncMessage.value = '无法读取 WebDAV 设置，请重新配置。'
  }
})()

export async function saveConfig(input: DavConfig | null) {
  await configReady
  const value = input && { ...input, url: normalizeDirectory(input.url.trim()), username: input.username.trim() }
  if (value && (!value.username || value.username.includes(':') || !value.password)) {
    throw new Error('请输入有效的用户名和应用密码。')
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
  if (davConfig.value !== config) return { position: remote.position, uploaded: false }
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
  return { position: uploaded ? local : remote.position, uploaded }
}

const uploads = new Map<string, ReturnType<typeof uploadPosition>>()
function upload(config: DavConfig, position: Position) {
  const current = uploads.get(position.id)
  if (current) return current
  const task = uploadPosition(config, position).finally(() => uploads.delete(position.id))
  uploads.set(position.id, task)
  return task
}

export async function openingPosition(id: string, pending?: Position) {
  await configReady
  const config = davConfig.value
  if (!config) return null
  if (config.auto && pending) {
    try {
      // A quick reopen may beat the scheduled upload. Wait only for this book.
      return (await upload(config, { ...pending })).position
    } catch (error) {
      syncMessage.value = syncError(error)
      scheduleUpload(60000)
      // A read-only directory can still supply a valid reading position.
    }
  }
  return (await download(config, id)).position
}

async function uploadPending(config: DavConfig) {
  let count = 0
  const failures: string[] = []
  for (const book of await listBooks()) {
    if (davConfig.value !== config) return
    if (!book.pendingPosition) continue
    try {
      if ((await upload(config, book.pendingPosition)).uploaded) count++
    } catch (error) {
      failures.push(book.title + ' · ' + syncError(error))
    }
  }
  if (davConfig.value !== config) return
  if (failures.length) throw new Error(failures.join('；'))
  syncMessage.value = count ? '已上传 ' + count + ' 本书的阅读进度。' : '阅读进度已是最新。'
}

export function syncError(error: unknown) {
  return error instanceof Error && /WebDAV|进度|服务器|设备/.test(error.message)
    ? error.message : '无法连接 WebDAV，请检查网络和目录地址。'
}

export function syncNow(): Promise<void> {
  if (running) return running
  const config = davConfig.value
  if (!config) return Promise.resolve()
  syncing.value = true
  running = uploadPending(config).catch(error => {
    syncMessage.value = syncError(error)
    if (davConfig.value === config) scheduleUpload(60000)
  }).finally(() => {
    syncing.value = false
    running = undefined
  })
  return running
}

// Coalesce turns and retry the persisted queue after interruptions or a restart.
export function scheduleUpload(delay = 3000) {
  if (!davConfig.value?.auto) return
  if (timer !== undefined) {
    if (delay !== 0) return
    clearTimeout(timer)
  }
  timer = window.setTimeout(async () => {
    timer = undefined
    if (running) await running
    if (davConfig.value?.auto) await syncNow()
  }, delay)
}
void configReady.then(() => scheduleUpload(0))
window.addEventListener('online', () => scheduleUpload(0))
