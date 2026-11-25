// Runs in the Electron main process or in the Android extension page.
export function normalizeDirectory(address) {
  const url = new URL(address)
  if (!['https:', 'http:'].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('请输入 HTTP 或 HTTPS WebDAV 目录地址')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

export async function requestProgress(config, id, write) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效的书籍标识')
  const directory = new URL('ReadBox/', normalizeDirectory(config.url))
  const url = new URL(id + '.json', directory)
  const credentials = new TextEncoder().encode(config.username + ':' + config.password)
  const headers = { Authorization: 'Basic ' + btoa(Array.from(credentials, n => String.fromCharCode(n)).join('')) }
  const options = { redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000) }
  if (write && !write.etag && !write.modified) {
    const folder = await fetch(directory, { ...options, method: 'MKCOL', headers })
    await folder.body?.cancel()
    // WebDAV returns 405 when the collection already exists.
    if (!folder.ok && folder.status !== 405) return { status: folder.status, body: '', etag: null, modified: null }
  }
  if (write) {
    headers['Content-Type'] = 'application/json'
    if (write.etag) headers['If-Match'] = write.etag
    else if (write.modified) headers['If-Unmodified-Since'] = write.modified
    else headers['If-None-Match'] = '*'
  }
  const response = await fetch(url, {
    ...options, method: write ? 'PUT' : 'GET', headers,
    body: write ? JSON.stringify(write.position) : undefined,
  })
  let body = ''
  if (!write && response.ok) {
    const decoder = new TextDecoder()
    let bytes = 0
    for await (const chunk of response.body) {
      // Progress contains a single CFI and chapter name.
      bytes += chunk.length
      if (bytes > 65536) throw new Error('云端进度文件过大')
      body += decoder.decode(chunk, { stream: true })
    }
    body += decoder.decode()
  } else await response.body?.cancel()
  return { status: response.status, body, etag: response.headers.get('etag'), modified: response.headers.get('last-modified') }
}
