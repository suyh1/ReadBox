<script setup lang="ts">
import { onMounted, ref } from 'vue'

const desktop = window.readbox
const settings = ref<RenderSettings>()
const pending = ref(false)
const error = ref('')

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
  try {
    const result = await desktop?.shortcut()
    shortcut.value = result?.key || ''
    if (result?.key && !result.active) shortcutStatus.value = '当前快捷键未能注册，请更换。'
  } catch { shortcutStatus.value = '无法读取老板键设置。' }
})
</script>
<template>
  <section v-if="desktop" aria-labelledby="display">
    <h2 id="display">显示设置</h2>
    <label v-if="settings">
      <input
        type="checkbox"
        :checked="settings.hardwareRequested"
        :disabled="pending"
        @change="update(($event.target as HTMLInputElement).checked)"
      />
      启用硬件加速
    </label>
    <div v-if="settings" role="status">
      <p>{{ settings.gpuCompositing ? '当前使用 GPU 合成' : '当前使用软件合成' }}</p>
      <p v-if="settings.forceSoftware">本次启动已强制使用软件绘制。</p>
      <p v-if="settings.restartRequired">设置已保存，下次启动时生效。</p>
    </div>
    <h2>老板键</h2>
    <label>隐藏 / 恢复
      <input class="shortcut-input" readonly :value="shortcut || '未设置'" :disabled="registering"
        aria-label="老板键快捷键" @keydown="capture" />
    </label>
    <small>点击输入框，按下单个键（如 F8）或组合键。该快捷键在其他应用中也会生效。</small>
    <button v-if="shortcut" :disabled="registering" @click="bindKey('')">关闭老板键</button>
    <p v-if="shortcutStatus" role="status">{{ shortcutStatus }}</p>
    <p v-if="error" role="alert">
      {{ error }}
      <button @click="update()">重新读取</button>
    </p>
  </section>
</template>
