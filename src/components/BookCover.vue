<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
const props = defineProps<{ title: string; cover?: Blob }>()
const url = ref('')
watch(
  () => props.cover,
  (cover) => {
    if (url.value) URL.revokeObjectURL(url.value)
    url.value = cover ? URL.createObjectURL(cover) : ''
  },
  { immediate: true },
)
function clearCover() {
  URL.revokeObjectURL(url.value)
  url.value = ''
}
onUnmounted(() => {
  if (url.value) URL.revokeObjectURL(url.value)
})
</script>
<template>
  <span class="cover" aria-hidden="true">
    <img v-if="url" :src="url" alt="" @error="clearCover" />
    <b v-else>{{ title }}</b>
  </span>
</template>
