import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import storage from '../desktop/data-directory.cjs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const temp = await mkdtemp(path.join(os.tmpdir(), 'readbox-migration-'))
const profile = path.join(temp, 'profile')
const parent = path.join(temp, '我的书库')
const target = path.join(parent, 'ReadBox')
const executablePath = process.argv[2]
let app
async function launch() {
  app = await electron.launch({
    executablePath, args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + profile],
    chromiumSandbox: true,
  })
  const page = await app.firstWindow()
  await page.locator('#ready').waitFor()
  return page
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise(resolve => {
      const req = indexedDB.open('readbox-library')
      req.onsuccess = () => resolve(req.result)
    })
    const getAll = store => new Promise(resolve => {
      const req = db.transaction(store).objectStore(store).getAll()
      req.onsuccess = () => resolve(req.result)
    })
    const [books, files] = await Promise.all([getAll('books'), getAll('files')])
    db.close()
    const hashes = await Promise.all(files.map(async f =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer())))))
    return { books: books.map(({ cover, ...book }) => book), hashes,
      prefs: localStorage.getItem('reader-preferences'), dav: await window.readbox.davSettings() }
  })
}

try {
  await mkdir(parent)
  let page = await launch()
  assert.equal(await page.evaluate(() => window.readbox.dataDirectory()), profile)
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('./fixtures/spreads.epub', import.meta.url)))
  await page.frameLocator('iframe').locator('p').first().waitFor()
  await page.getByRole('button', { name: '加书签', exact: true }).click()
  await page.getByRole('button', { name: '已加书签' }).waitFor()
  await page.getByRole('button', { name: '书架', exact: true }).click()
  await page.getByRole('button', { name: '桌面设置' }).click()
  await page.evaluate(async () => {
    localStorage.setItem('reader-preferences', JSON.stringify({ theme: 'sepia' }))
    await window.readbox.saveDavSettings({ url: 'https://example.invalid/', username: 'test', password: 'test' })
  })
  const before = await snapshot(page)
  assert.equal(before.hashes.length, 1)
  assert.ok(before.books[0].marks.length)
  // The harness owns the next Electron process so it can inspect the new session.
  await app.evaluate(({ dialog, app }, parent) => {
    dialog.showOpenDialog = async () => ({ filePaths: [parent], canceled: false })
    dialog.showMessageBox = async () => ({ response: 0 })
    app.relaunch = () => {}
  }, parent)
  await page.getByRole('button', { name: '更改存储位置…' }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-labelledby="storage-title"] button').disabled)
  assert.ok(!(await readdir(profile)).includes('data-location.json'))
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }) })
  await Promise.all([app.waitForEvent('close'), page.getByRole('button', { name: '更改存储位置…' }).click()])
  app = undefined

  page = await launch()
  assert.equal(await page.evaluate(() => window.readbox.dataDirectory()), target)
  assert.equal(await app.evaluate(({ session }) => session.defaultSession.storagePath), target)
  assert.deepEqual(await snapshot(page), before)
  assert.ok(!(await readdir(profile)).includes('IndexedDB'))
  await page.getByRole('button', { name: '接着读' }).click()
  await page.frameLocator('iframe').locator('p').first().waitFor()
  await page.getByRole('button', { name: '已加书签' }).waitFor()
  await page.evaluate(() => localStorage.setItem('migration-check', 'saved'))
  await app.close()
  app = undefined
  page = await launch()
  assert.equal(await page.evaluate(() => localStorage.getItem('migration-check')), 'saved')
  await app.close()
  app = undefined

  // A different folder appearing between confirmation and restart must survive.
  const otherParent = path.join(temp, '另一个位置')
  await mkdir(otherParent)
  const active = storage.dataDirectory(profile)
  assert.throws(() => active.schedule(target))
  active.schedule(otherParent)
  const occupied = path.join(otherParent, 'ReadBox')
  await mkdir(occupied)
  await writeFile(path.join(occupied, 'keep.txt'), '已有文件')
  const fallback = storage.dataDirectory(profile)
  assert.equal(fallback.current, target)
  assert.match(fallback.notice, /迁移失败/)
  assert.equal(await readFile(path.join(occupied, 'keep.txt'), 'utf8'), '已有文件')
  page = await launch()
  assert.equal(await page.evaluate(() => localStorage.getItem('migration-check')), 'saved')
  console.log('桌面书库迁移、取消、失败回退、重启读取和后续写入检查通过')
} finally {
  if (app) await app.close()
  await rm(temp, { recursive: true, force: true, maxRetries: 3 })
}
