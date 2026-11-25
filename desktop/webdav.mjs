// Runs in the Electron main process or in the Android extension page.
export function normalizeDirectory(address) {
  let url
  try { url = new URL(address) } catch { /* Report the same validation error for malformed URLs. */ }
  if (!url || !['https:', 'http:'].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('请输入 HTTP 或 HTTPS WebDAV 目录地址。')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

function davRequest(config) {
  const credentials = new TextEncoder().encode(config.username + ':' + config.password)
  const authorization = 'Basic ' + btoa(Array.from(credentials, n => String.fromCharCode(n)).join(''))
  return (url, method, headers, body) => fetch(url, {
    method, headers: { Authorization: authorization, ...headers }, body,
    redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000),
  })
}

async function readBody(response) {
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.length
    if (bytes > 65536) throw new Error('WebDAV 响应过大，请检查目录地址。')
    text += decoder.decode(chunk, { stream: true })
  }
  return text + decoder.decode()
}

async function directoryStatus(request, url) {
  const response = await request(url, 'PROPFIND', { Depth: '0', 'Content-Type': 'application/xml' },
    '<propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>')
  if (response.status === 207) {
    const xml = await readBody(response)
    if (/<(?:[\w.-]+:)?collection(?:\s|\/?>)/.test(xml)) return 200
    throw new Error('WebDAV 地址未指向文件夹，请检查目录地址。')
  }
  await response.body?.cancel()
  if (response.ok) throw new Error('服务器未返回 WebDAV 目录信息，请填写 WebDAV 目录地址。')
  return response.status
}

export function probeDirectory(config) {
  return directoryStatus(davRequest(config), normalizeDirectory(config.url))
}

// Some servers use 409 for descendants of a missing collection. Confirm a
// missing ancestor before interpreting an otherwise ambiguous GET/PUT conflict.
async function missingDirectory(request, directory) {
  let current = directory
  for (;;) {
    const status = await directoryStatus(request, current)
    if (status !== 409 || current.pathname === '/') return status === 404
    current = new URL('../', current)
  }
}

async function createCollection(request, directory) {
  const response = await request(directory, 'MKCOL')
  await response.body?.cancel()
  if (response.ok) return response.status
  // Some servers report an existing collection as 409 instead of 405.
  if (response.status === 405 || response.status === 409) {
    const status = await directoryStatus(request, directory)
    if (status !== 404) return status
  }
  return response.status
}

async function ensureDirectory(request, directory) {
  const missing = []
  let current = directory
  for (;;) {
    const status = await directoryStatus(request, current)
    if (status === 200) break
    if ((status !== 404 && status !== 409) || current.pathname === '/') return status
    missing.push(current)
    current = new URL('../', current)
  }
  for (const path of missing.reverse()) {
    const status = await createCollection(request, path)
    if (status < 200 || status >= 300) return status
  }
  return 200
}

export async function requestProgress(config, id, write) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效的书籍标识')
  const directory = new URL('ReadBox/', normalizeDirectory(config.url))
  const url = new URL(id + '.json', directory)
  const request = davRequest(config)
  const empty = status => ({ status, body: '', etag: null, modified: null })
  if (!write) {
    const response = await request(url, 'GET')
    if (response.ok) return {
      status: response.status, body: await readBody(response),
      etag: response.headers.get('etag'), modified: response.headers.get('last-modified'),
    }
    await response.body?.cancel()
    if (response.status === 409 && await missingDirectory(request, directory)) return empty(404)
    return empty(response.status)
  }

  const headers = { 'Content-Type': 'application/json' }
  if (write.etag) headers['If-Match'] = write.etag
  else if (write.modified) headers['If-Unmodified-Since'] = write.modified
  else {
    headers['If-None-Match'] = '*'
    const ready = await ensureDirectory(request, directory)
    if (ready !== 200) return empty(ready)
  }

  // A missing parent can produce 409 on PUT. Prepare it and retry the same
  // conditional write once, preserving protection against concurrent updates.
  const put = async () => {
    const response = await request(url, 'PUT', headers, JSON.stringify(write.position))
    await response.body?.cancel()
    return response.status
  }
  let status = await put()
  if (status === 409 && await missingDirectory(request, directory)) {
    const ready = await ensureDirectory(request, directory)
    status = ready === 200 ? await put() : ready
  }
  return empty(status)
}
