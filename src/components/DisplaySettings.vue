<script setup lang="ts">
import { onMounted, ref } from 'vue'

const desktop = window.readbox
const settings = ref<RenderSettings>()
const pending = ref(false)
const error = ref('')
const directory = ref('')
const choosingDirectory = ref(false)
const directoryError = ref('')

async function migrateData() {
  if (!desktop || choosingDirectory.value) return
  choosingDirectory.value = true
  directoryError.value = ''
  try {
    await desktop.migrateData()
  } catch (e) {
    directoryError.value = e instanceof Error ? e.message.replace(/^.*?Error: /, '') : '无法迁移，请检查目录权限。'
  } finally { choosingDirectory.value = false }
}

async function update(enabled?: boolean) {
  if (!desktop) return
  pending.value = true
  error.value = ''
  try {
    settings.value =
      enabled === undefined ? await desktop.rendering() : await desktop.setHardwareAcceleration(enabled)
  } catch {
    error.value = '无法读取或保存显示设置，请重试。'
  } finally {
    pending.value = false
  }
}

const shortcut = ref('')
const shortcutStatus = ref('')
const registering = ref(false)
async function bindKey(key: string) {
  if (!desktop || registering.value) return
  registering.value = true
  try {
    const result = await desktop.setShortcut(key)
    shortcut.value = result.key
    shortcutStatus.value = key ? '老板键已生效。' : '老板键已关闭。'
  } catch {
    shortcutStatus.value = '无法注册这个快捷键，可能已被占用。请换一个键再试。'
  } finally { registering.value = false }
}
function capture(event: KeyboardEvent) {
  if (event.key === 'Tab' || event.key === 'Escape') return
  event.preventDefault()
  if (event.repeat || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
  const modifiers = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean)
  const key = event.code.replace(/^(Key|Digit)/, '')
  if (!/^(?:[A-Z0-9]|Space|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(key)) {
    shortcutStatus.value = '请选择功能键、字母、数字或空格，也可以搭配修饰键。'
    return
  }
  void bindKey([...modifiers, key].join('+'))
}
onMounted(async () => {
  void update()
  try { directory.value = await desktop?.dataDirectory() ?? '' }
  catch { directoryError.value = '无法读取数据目录。' }
  try {
    const result = await desktop?.shortcut()
    shortcut.value = result?.key || ''
    if (result?.key && !result.active) shortcutStatus.value = '当前快捷键未能注册，请更换。'
  } catch { shortcutStatus.value = '无法读取老板键设置。' }
})
</script>
<template>
  <div v-if="desktop" class="display-settings">
    <section aria-label="绘制方式">
      <label v-if="settings" class="setting-row">
        启用硬件加速
        <input
          type="checkbox" role="switch"
          :checked="settings.hardwareRequested"
          :disabled="pending"
          @change="update(($event.target as HTMLInputElement).checked)"
        />
      </label>
      <div v-if="settings" role="status">
        <p>{{ settings.gpuCompositing ? '当前使用 GPU 合成' : '当前使用软件合成' }}</p>
        <p v-if="settings.forceSoftware">本次启动已强制使用软件绘制。</p>
        <p v-if="settings.restartRequired">设置已保存，下次启动时生效。</p>
      </div>
    </section>
    <section aria-labelledby="shortcut-title">
      <h3 id="shortcut-title">老板键</h3>
      <label class="setting-row">隐藏 / 恢复
        <input class="shortcut-input" readonly :value="shortcut || '未设置'" :disabled="registering"
          aria-label="老板键快捷键" @keydown="capture" />
      </label>
      <small>点击输入框，按下单个键（如 F8）或组合键。该快捷键在其他应用中也会生效。</small>
      <button v-if="shortcut" :disabled="registering" @click="bindKey('')">关闭老板键</button>
      <p v-if="shortcutStatus" role="status">{{ shortcutStatus }}</p>
    </section>
    <section aria-labelledby="storage-title">
      <h3 id="storage-title">数据与书籍</h3>
      <p class="data-directory">当前目录：{{ directory }}</p>
      <small>选择存放位置后，将在其中创建 ReadBox 文件夹并迁移现有书库。</small>
      <button :disabled="!directory || choosingDirectory" @click="migrateData">更改存储位置…</button>
      <p v-if="directoryError" role="alert">{{ directoryError }}</p>
    </section>
    <p v-if="error" role="alert">
      {{ error }}
      <button @click="update()">重新读取</button>
    </p>
  </div>
</template>
