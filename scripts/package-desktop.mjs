import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'

const root = fileURLToPath(new URL('../', import.meta.url))
const [platform = process.platform, arch = process.arch] = process.argv.slice(2)
if (!['linux-x64', 'linux-arm64', 'win32-x64'].includes(platform + '-' + arch)) {
  throw new Error('仅支持 linux x64、linux arm64、win32 x64')
}
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const out = path.join(root, 'out')
await mkdir(out, { recursive: true })
const scratch = await mkdtemp(path.join(out, 'package-'))
try {
  const app = path.join(scratch, 'app')
  await mkdir(app)
  for (const name of ['dist', 'desktop', 'LICENSE']) {
    await cp(path.join(root, name), path.join(app, name), { recursive: true })
  }
  const { name, productName, version, main, description, license } = manifest
  await writeFile(path.join(app, 'package.json'), JSON.stringify({ name, productName, version, main, description, license }))
  const [runtime] = await packager({
    dir: app, out: scratch, name: productName, executableName: 'readbox',
    platform, arch, electronVersion: manifest.devDependencies.electron, asar: true, prune: false,
  })
  const packages = path.join(scratch, 'packages')
  await mkdir(packages)
  let filename
  if (platform === 'linux') {
    filename = `ReadBox-${version}-linux-${arch === 'x64' ? 'amd64' : 'arm64'}.deb`
    execFileSync('python3', [path.join(root, 'scripts/deb.py'), runtime, arch, version, packages], { stdio: 'inherit' })
  } else {
    filename = `ReadBox-${version}-windows-x64.exe`
    const { build, Platform, Arch } = await import('electron-builder')
    await build({
      projectDir: root, prepackaged: runtime, publish: 'never',
      targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
      config: {
        appId: 'io.github.suyh1.readbox', productName, executableName: 'readbox',
        directories: { output: packages }, artifactName: filename,
        nsis: { oneClick: false, perMachine: false, differentialPackage: false, useZip: true, installerLanguages: ['zh_CN', 'en_US'] },
      },
    })
  }
  await rename(path.join(packages, filename), path.join(out, filename))
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 })
}
