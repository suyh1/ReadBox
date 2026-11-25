import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { _electron as electron } from 'playwright-core'

const profile = await mkdtemp(path.join(os.tmpdir(), 'readbox-display-'))
const executablePath = process.argv[2]
async function launch(extraArgs, verify) {
  const app = await electron.launch({
    executablePath, args: ['--user-data-dir=' + profile, ...extraArgs], chromiumSandbox: true,
    timeout: 30000,
  })
  try {
    const page = await app.firstWindow()
    await page.locator('#ready').waitFor()
    await page.getByRole("button", { name: "显示设置" }).click()
    const toggle = page.getByRole('checkbox', { name: '启用硬件加速' })
    await toggle.waitFor()
    await verify(page, toggle)
  } finally {
    await app.close()
  }
}

try {
  await launch([], async (page, toggle) => {
    assert.equal(await toggle.isChecked(), false)
    await page.getByText('当前使用软件合成').waitFor()
    await toggle.check()
    await page.getByText('设置已保存，下次启动时生效。').waitFor()
  })
  await launch(['--disable-gpu'], async (page, toggle) => {
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
    await frame.getByRole('heading', { name: '折角与余白' }).waitFor()
    await button('已加书签').waitFor()
  })
  console.log('桌面启动、显示设置、EPUB 阅读、批注与续读检查通过')
} finally {
  await rm(profile, { recursive: true, force: true, maxRetries: 3 })
}
