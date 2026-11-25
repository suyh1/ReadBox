import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { _electron as electron } from 'playwright-core'

const profile = await mkdtemp(path.join(os.tmpdir(), 'readbox-display-'))
const executablePath = process.argv[2]
const secondProfile = await mkdtemp(path.join(os.tmpdir(), 'readbox-sync-'))
const documents = new Map()
let writes = 0
let offline = false
const collections = new Set(['/dav/'])
let conflict = false
const server = createServer(async (req, res) => {
  const file = documents.get(req.url)
  if (offline) res.writeHead(503)
  else if (req.headers.authorization !== 'Basic ' + Buffer.from('reader:app-password').toString('base64')) res.writeHead(401)
  else if (req.method === 'PROPFIND') {
    assert.equal(req.headers.depth, '0')
    if (collections.has(req.url)) {
      res.writeHead(207, { 'Content-Type': 'application/xml' })
      res.end('<D:multistatus xmlns:D="DAV:"><D:response><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response></D:multistatus>')
      return
    }
    const parent = new URL('../', 'http://localhost' + req.url).pathname
    res.writeHead(collections.has(parent) ? 404 : 409)
  }
  else if (req.method === 'MKCOL') {
    const parent = new URL('../', 'http://localhost' + req.url).pathname
    if (!collections.has(parent)) res.writeHead(409)
    else {
      // Another client creates the collection between PROPFIND and MKCOL.
      collections.add(req.url)
      res.writeHead(req.url.endsWith('/ReadBox/') ? 409 : 201)
    }
  }
  else if (!/^\/dav\/books\/ReadBox\/[a-f0-9]{64}\.json$/.test(req.url)) res.writeHead(400)
  else if (req.method === 'GET' && file) { res.writeHead(200, { etag: file.etag }); res.end(file.json); return }
  else if (req.method === 'GET') res.writeHead(collections.has('/dav/books/ReadBox/') ? 404 : 409,
    { 'Last-Modified': new Date().toUTCString() })
  else if (req.method === 'PUT') {
    if (conflict) res.writeHead(412)
    else if (!collections.has('/dav/books/ReadBox/')) res.writeHead(409)
    else if (file ? req.headers['if-match'] !== file.etag : req.headers['if-none-match'] !== '*') res.writeHead(412)
    else {
      let json = ''
      for await (const chunk of req) json += chunk
      documents.set(req.url, { json, etag: '"' + ++writes + '"' })
      res.writeHead(201)
    }
  } else res.writeHead(405)
  res.end()
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
async function configure(page, auto) {
  const button = name => page.getByRole('button', { name, exact: true })
  await page.getByRole('button', { name: '进度同步', exact: true }).click()
  const base = 'http://127.0.0.1:' + server.address().port + '/dav/'
  assert.equal(await page.getByLabel('WebDAV 目录 URL').inputValue(), 'https://dav.jianguoyun.com/dav/')
  await page.getByLabel('WebDAV 目录 URL').fill(base)
  await page.getByLabel('用户名', { exact: true }).fill('reader')
  const password = page.getByLabel('应用密码', { exact: true })
  await password.fill('incorrect')
  await button('检测连接').click()
  await page.getByText(/WebDAV 拒绝访问/).waitFor()
  await password.fill('app-password')
  await button('显示应用密码').click()
  assert.equal(await password.getAttribute('type'), 'text')
  await button('隐藏应用密码').click()
  assert.equal(await password.getAttribute('type'), 'password')
  await button('检测连接').click()
  await page.getByText('连接成功，目录可读取。').waitFor()
  await page.getByLabel('WebDAV 目录 URL').fill(base + 'books/')
  await page.getByRole('radio', { name: auto ? '自动同步' : '手动同步' }).check()
  if (auto) {
    await page.getByRole('radio', { name: '定时上传' }).check()
    await page.getByLabel('上传间隔（秒）').fill('2')
  }
  await page.getByRole('button', { name: '保存设置' }).click()
  await page.getByText('同步设置已保存。').waitFor()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
}
async function launch(extraArgs, verify, dataDir = profile) {
  const app = await electron.launch({
    executablePath, args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + dataDir, ...extraArgs], chromiumSandbox: true,
    timeout: 30000,
  })
  try {
    const page = await app.firstWindow()
    await page.locator('#ready').waitFor()
    await page.getByRole("button", { name: "显示设置" }).click()
    const toggle = page.getByRole('checkbox', { name: '启用硬件加速' })
    await toggle.waitFor()
    await verify(page, toggle, app)
  } finally {
    await app.close()
  }
}

try {
  await launch([], async (page, toggle, app) => {
    const shortcut = page.getByRole('textbox', { name: '老板键快捷键' })
    assert.equal(await shortcut.inputValue(), 'F8')
    assert.ok(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('F8')))
    await shortcut.press('Control+Alt+J')
    await page.getByText('老板键已生效。').waitFor()
    assert.ok(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+J')))
    await shortcut.press('F9')
    await page.waitForFunction(() => document.querySelector('.shortcut-input')?.value === 'F9')
    assert.ok(await app.evaluate(({ globalShortcut }) =>
      globalShortcut.isRegistered('F9') && !globalShortcut.isRegistered('Control+Alt+J') && !globalShortcut.isRegistered('F8')))
    assert.equal(await toggle.isChecked(), false)
    await page.getByText('当前使用软件合成').waitFor()
    await toggle.check()
    await page.getByText('设置已保存，下次启动时生效。').waitFor()
  })
  await launch(['--disable-gpu'], async (page, toggle) => {
    assert.equal(await page.getByLabel('老板键快捷键').inputValue(), 'F9')
    assert.equal(await toggle.isChecked(), true)
    await page.getByText('本次启动已强制使用软件绘制。').waitFor()
    await page.getByText('当前使用软件合成').waitFor()
    await toggle.uncheck()
    await page.getByText('设置已保存，下次启动时生效。').waitFor()
  })
  await launch([], async (page) => {
    const button = name => page.getByRole('button', { name, exact: true })
    await button('关闭').click()
    await button('开始阅读').click()
    const frame = page.frameLocator('iframe')
    await frame.getByRole('heading', { name: '窗边的一页' }).waitFor()
    await frame.getByText('〔注〕').click()
    await page.locator('.footnote').waitFor()
    await button('关闭面板').click()
    await button('书内搜索').click()
    await page.getByRole('searchbox', { name: '搜索全书正文' }).fill('车票')
    await button('搜索').click()
    await page.getByText('找到 2 处').waitFor()
    await page.locator('.entries button').first().click()
    await frame.getByRole('heading', { name: '折角与余白' }).waitFor()
    await button('加书签').click()
    await button('已加书签').waitFor()
    await frame.locator('p').first().evaluate(paragraph => {
      const text = paragraph.firstChild
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 8)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    })
    await button('写笔记').click()
    await page.getByLabel('我的笔记').fill('重读这一段')
    await button('保存笔记').click()
    await button('书摘').click()
    await page.getByText('重读这一段').waitFor()
    await button('关闭面板').click()
    await button('书架').click()
    await button('接着读').waitFor()
    await page.reload()
    await button('接着读').click()
    await frame.getByRole('heading', { name: '窗边的一页' }).waitFor()
    await button('阅读时长').click()
    await page.waitForFunction(() => document.querySelector('.time-stats dd')?.textContent !== '0 秒')
    await button('关闭面板').click()
    await page.setViewportSize({ width: 320, height: 640 })
    await page.waitForFunction(() => {
      const tools = document.querySelector('.reader-tools')
      const buttons = Array.from(tools.querySelectorAll('button'))
      return buttons.every(button => {
        const rect = button.getBoundingClientRect()
        return rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth
      })
    })
  })
  await launch([], async (page) => {
    const button = name => page.getByRole('button', { name, exact: true })
    async function chooseFlow(value) {
      await button('阅读设置').click()
      await page.getByLabel('阅读方式').selectOption(value)
      await button('关闭面板').click()
    }
    async function expectPages(numbers) {
      // Check the visible text in each half, including the iframe's scroll offset.
      await page.waitForFunction(expected => {
        const frame = document.querySelector('iframe')
        if (!frame?.contentDocument?.body) return false
        const view = document.querySelector('.viewport').getBoundingClientRect()
        const offset = frame.getBoundingClientRect().left
        const visible = Array.from(frame.contentDocument.querySelectorAll('p')).flatMap(p => {
          const range = frame.contentDocument.createRange()
          range.selectNodeContents(p)
          const x = offset + range.getBoundingClientRect().left - view.left
          return x >= 0 && x < view.width ? [{ text: p.textContent, x }] : []
        })
        return visible.length === expected.length && visible.every(({ text, x }, i) =>
          text === '第 ' + expected[i] + ' 页' && (expected.length === 1 || Math.floor(x * 2 / view.width) === i))
      }, numbers)
      const range = numbers.join('–')
      await page.waitForFunction(prefix => document.querySelector('.page-info small')?.textContent.trim().startsWith(prefix), range + ' / 8')
    }

    await button('关闭').click()
    await configure(page, false)
    await page.setViewportSize({ width: 1000, height: 680 })
    await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('./fixtures/spreads.epub', import.meta.url)))
    await expectPages([1])
    await button('目录').click()
    await button('第一辑').click()
    assert.equal(await button('第一页').count(), 0)
    await button('上卷').focus()
    await page.keyboard.press('Space')
    assert.equal(await button('上卷').getAttribute('aria-expanded'), 'false')
    assert.equal(await button('第一辑').count(), 0)
    await button('关闭面板').click()
    await button('目录').click()
    assert.equal(await button('第一辑').count(), 0)
    await button('上卷').click()
    assert.equal(await button('第一辑').getAttribute('aria-expanded'), 'false')
    await button('第五页').click()
    await expectPages([5])
    await button('目录').click()
    await button('跳转到第一辑').click()
    await expectPages([1])
    await chooseFlow('two-page')
    await expectPages([1, 2])
    await button('下一页').click()
    await expectPages([3, 4])
    await page.keyboard.press('ArrowLeft')
    await expectPages([1, 2])
    await page.keyboard.press('PageDown')
    await expectPages([3, 4])
    await button('上一页').click()
    await expectPages([1, 2])
    await button('专注阅读').click()
    await button('下一页').click()
    await expectPages([3, 4])
    await button('退出专注').click()
    await button('阅读设置').click()
    await page.getByText('WebDAV 进度同步', { exact: true }).click()
    assert.equal(writes, 0)
    await button('立即同步').click()
    await page.getByText(/已上传 .* 本书的阅读进度/).waitFor()
    const initialWrites = writes
    await button('立即同步').click()
    await page.getByText('阅读进度已是最新。').waitFor()
    assert.equal(writes, initialWrites)
    await button('关闭面板').click()
    await button('书架').click()
    await page.reload()
    await button('接着读').click()
    await expectPages([3, 4])
    await page.setViewportSize({ width: 720, height: 680 })
    await expectPages([3])
    await page.setViewportSize({ width: 1000, height: 680 })
    await expectPages([3, 4])
    await chooseFlow('paginated')
    await expectPages([3])
  })
  await launch([], async (page) => {
    const button = name => page.getByRole('button', { name, exact: true })
    await button('关闭').click()
    await configure(page, true)
    await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('./fixtures/spreads.epub', import.meta.url)))
    const pageNumber = async n => page.waitForFunction(n =>
      document.querySelector('.page-info small')?.textContent.trim().startsWith(n + ' / 8'), n)
    await pageNumber(3)
    const before = writes
    await button('下一页').click()
    await pageNumber(4)
    await button('阅读设置').click()
    await page.getByText('WebDAV 进度同步', { exact: true }).click()
    await page.getByText('已上传 1 本书的阅读进度。').waitFor()
    assert.ok(await page.getByRole('radio', { name: '定时上传' }).isChecked())
    assert.equal(await page.getByLabel('上传间隔（秒）').inputValue(), '2')
    await page.getByRole('radio', { name: '离开书籍时' }).check()
    await button('保存设置').click()
    await page.getByText('同步设置已保存。').waitFor()
    assert.equal(writes, before + 1)
    await button('关闭面板').click()
    offline = true
    await button('书架').click()
    await button('接着读').click()
    await pageNumber(1)
    await page.getByText(/HTTP 503.*从书首打开/).waitFor()
    await button('下一页').click()
    await pageNumber(2)
    await button('阅读设置').click()
    await page.getByText('WebDAV 进度同步', { exact: true }).click()
    offline = false
    conflict = true
    await button('立即同步').click()
    await page.getByText(/另一台设备刚更新了进度/).waitFor()
    assert.equal(writes, before + 1)
    conflict = false
    await button('立即同步').click()
    await page.getByText('已上传 1 本书的阅读进度。').waitFor()
    assert.equal(writes, before + 2)
    await button('关闭面板').click()
    await button('书架').click()
    await page.reload()
    await button('进度同步').click()
    assert.ok(await page.getByRole('radio', { name: '离开书籍时' }).isChecked())
    assert.equal(await page.getByLabel('WebDAV 目录 URL').inputValue(), 'http://127.0.0.1:' + server.address().port + '/dav/books/')
    assert.equal(await page.getByLabel('应用密码', { exact: true }).getAttribute('type'), 'password')
    await button('关闭').click()
    await button('接着读').click()
    await pageNumber(2)
    await button('下一页').click()
    await pageNumber(3)
    await page.waitForTimeout(2200)
    assert.equal(writes, before + 2)
    await button('书架').click()
    await page.waitForFunction(() => !document.querySelector('.reader'))
    await page.getByRole('button', { name: '进度同步', exact: true }).click()
    await page.getByText('已上传 1 本书的阅读进度。').waitFor()
    assert.equal(writes, before + 3)
  }, secondProfile)
  console.log('老板键、阅读计时、分页、批注、WebDAV 增量同步和跨设备续读检查通过')
} finally {
  server.close()
  await rm(secondProfile, { recursive: true, force: true, maxRetries: 3 })
  await rm(profile, { recursive: true, force: true, maxRetries: 3 })
}
