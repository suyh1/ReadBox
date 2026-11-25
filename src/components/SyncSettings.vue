<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { Eye, EyeOff } from '@lucide/vue'
import { davConfig, defaultConfig, saveConfig, syncNow, syncing, syncMessage, syncError, testConnection } from '../reader/sync'

const passwordId = useId()
const form = ref({ ...defaultConfig })
const revealed = ref(false)
const saving = ref(false)
const testing = ref(false)
const feedback = ref('')
const connectionResult = ref('')
watch(davConfig, value => {
  form.value = { ...(value || defaultConfig) }
  revealed.value = false
}, { immediate: true })
watch(() => [form.value.url, form.value.username, form.value.password], () => { connectionResult.value = '' })
watch(form, () => { feedback.value = '' }, { deep: true })
const changed = computed(() => {
  const saved = davConfig.value
  return !saved || (Object.keys(defaultConfig) as (keyof typeof defaultConfig)[]).some(key => form.value[key] !== saved[key])
})
const busy = computed(() => saving.value || testing.value || syncing.value)
async function test() {
  testing.value = true
  connectionResult.value = ''
  try {
    await testConnection(form.value)
    connectionResult.value = '连接成功，目录可读取。'
  } catch (cause) {
    connectionResult.value = syncError(cause)
  } finally {
    testing.value = false
  }
}
async function save(clear = false) {
  saving.value = true
  try {
    await saveConfig(clear ? null : form.value)
  } catch (cause) {
    feedback.value = cause instanceof Error && /请输入/.test(cause.message) ? cause.message : '保存失败，请检查本机存储。'
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <form class="sync-settings" aria-label="WebDAV 进度同步" @submit.prevent="save()">
    <fieldset :disabled="saving || testing">
      <legend>WebDAV 连接</legend>
      <small>在各台设备上填写同一目录，打开同一本书即可接着读。</small>
      <label>WebDAV 目录 URL
        <input v-model="form.url" type="url" required placeholder="https://dav.jianguoyun.com/dav/" />
      </label>
      <small v-if="form.url.startsWith('http://')">HTTP 会以明文传输应用密码。</small>
      <div class="sync-fields">
        <label>用户名<input v-model="form.username" required autocomplete="username" placeholder="账户名或邮箱" /></label>
        <div class="sync-password">
          <label :for="passwordId">应用密码</label>
          <div>
            <input :id="passwordId" v-model="form.password" :type="revealed ? 'text' : 'password'" required autocomplete="off" spellcheck="false" />
            <button type="button" class="icon" :aria-label="revealed ? '隐藏应用密码' : '显示应用密码'" @click="revealed = !revealed">
              <component :is="revealed ? EyeOff : Eye" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <div class="sync-test">
        <button type="button" :disabled="busy || !form.url || !form.username || !form.password" @click="test">
          {{ testing ? '检测中…' : '检测连接' }}
        </button>
        <small role="status">{{ connectionResult }}</small>
      </div>
    </fieldset>
    <fieldset :disabled="saving || testing">
      <legend>进度上传</legend>
      <label>上传方式
        <select v-model="form.auto" aria-label="上传方式">
          <option :value="true">自动同步</option>
          <option :value="false">手动同步</option>
        </select>
      </label>
      <div v-if="form.auto" class="sync-fields">
        <label>触发规则
          <select v-model="form.rule" aria-label="触发规则">
            <option value="both">定时及离开书籍时</option>
            <option value="interval">定时上传</option>
            <option value="leave">离开书籍时</option>
          </select>
        </label>
        <label v-if="form.rule !== 'leave'">上传间隔（秒）
          <input v-model.number="form.intervalSeconds" type="number" required min="1" max="3600" step="1" />
        </label>
      </div>
      <small>{{ !form.auto ? '翻页后，点「立即同步」上传待同步进度。' : form.rule === 'leave' ? '返回书房时上传待同步进度。' : '有进度变更时按间隔上传，连续翻页只上传最新位置。' }}</small>
    </fieldset>
    <div class="sync-actions">
      <button :class="{ primary: changed }" :disabled="busy || !changed">保存设置</button>
      <button type="button" :class="{ primary: !changed }" :disabled="busy || changed" @click="syncNow()">
        {{ syncing ? '同步中…' : '立即同步' }}
      </button>
      <button v-if="davConfig" class="quiet" type="button" :disabled="busy" @click="save(true)">清除配置</button>
    </div>
    <p v-if="feedback || (!changed && syncMessage) || (!davConfig && syncMessage)" class="sync-status" role="status">{{ feedback || syncMessage }}</p>
  </form>
</template>
