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
    settings.value = enabled === undefined
      ? await desktop.rendering()
      : await desktop.setHardwareAcceleration(enabled)
  } catch {
    error.value = '无法读取或保存显示设置，请重试。'
  } finally {
    pending.value = false
  }
}

onMounted(() => update())
</script>

<template>
  <header class="bar"><strong>ReadBox</strong></header>
  <main>
    <h1>ReadBox</h1>
    <p id="ready">本地界面已就绪。</p>
    <section v-if="desktop" aria-labelledby="display">
      <h2 id="display">显示设置</h2>
      <label v-if="settings">
        <input type="checkbox" :checked="settings.hardwareRequested" :disabled="pending"
          @change="update(($event.target as HTMLInputElement).checked)" />
        启用硬件加速
      </label>
      <div v-if="settings" role="status">
        <p>{{ settings.gpuCompositing ? '当前使用 GPU 合成' : '当前使用软件合成' }}</p>
        <p v-if="settings.forceSoftware">本次启动已强制使用软件绘制。</p>
        <p v-if="settings.restartRequired">设置已保存，下次启动时生效。</p>
      </div>
      <p v-if="error" role="alert">{{ error }} <button @click="update()">重新读取</button></p>
    </section>
  </main>
</template>
