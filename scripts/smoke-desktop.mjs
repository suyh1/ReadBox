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
  console.log('桌面启动、显示设置持久化与软件绘制恢复检查通过')
} finally {
  await rm(profile, { recursive: true, force: true, maxRetries: 3 })
}
