<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { davConfig, saveConfig, syncNow, syncing, syncMessage } from '../reader/sync'

const blank = { url: '', username: '', password: '', auto: true }
const form = ref({ ...blank })
const editing = ref(false)
const saving = ref(false)
const error = ref('')
watch(davConfig, value => { form.value = { ...(value || blank) }; editing.value = false }, { immediate: true })
const changed = computed(() => editing.value || !davConfig.value)
async function save(clear = false) {
  saving.value = true
  error.value = ''
  try {
    await saveConfig(clear ? null : form.value)
  } catch (cause) {
    error.value = cause instanceof Error && /请输入/.test(cause.message) ? cause.message : '保存失败，请检查目录地址及本机存储。'
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <section class="sync-settings" aria-label="WebDAV 进度同步">
    <form @submit.prevent="save()" @input="editing = true">
      <label>WebDAV 目录 URL
        <input v-model="form.url" type="url" required placeholder="https://dav.jianguoyun.com/dav/" />
      </label>
      <small v-if="form.url.startsWith('http://')">HTTP 会以明文传输应用密码。</small>
      <label>用户名<input v-model="form.username" required autocomplete="username" placeholder="坚果云账户邮箱" /></label>
      <label>应用密码<input v-model="form.password" type="password" required autocomplete="off" /></label>
      <label>上传方式
        <select v-model="form.auto">
          <option :value="true">自动同步</option>
          <option :value="false">手动同步</option>
        </select>
      </label>
      <small>两台设备请填写同一目录。每次打开书籍都会读取云端进度。</small>
      <div class="sync-actions">
        <button class="primary" :disabled="saving || syncing || !changed">保存设置</button>
        <button type="button" :disabled="saving || syncing || changed" @click="syncNow">
          {{ syncing ? '同步中…' : '立即同步' }}
        </button>
        <button v-if="davConfig" type="button" :disabled="saving || syncing" @click="save(true)">清除配置</button>
      </div>
    </form>
    <p v-if="error || syncMessage" role="status">{{ error || syncMessage }}</p>
  </section>
</template>
