<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

defineProps<{ text: string }>()
const frame = ref<HTMLElement>()
const line = ref<HTMLElement>()
const overflow = ref(0)
let observer: ResizeObserver
onMounted(() => {
  observer = new ResizeObserver(() => {
    overflow.value = Math.max(0, line.value!.offsetWidth - frame.value!.clientWidth)
  })
  observer.observe(frame.value!)
  observer.observe(line.value!)
})
onUnmounted(() => observer.disconnect())
</script>
<template>
  <span ref="frame" class="marquee" :class="{ overflowing: overflow > 0 }"
    :tabindex="overflow > 0 ? 0 : undefined" :title="text"
    :style="{ '--travel': -overflow + 'px', '--duration': Math.max(2, overflow / 45) + 's' }">
    <span ref="line">{{ text }}</span>
  </span>
</template>
<style scoped>
.marquee { display: block; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.marquee > span { display: inline-block; }
.overflowing:is(:hover, :focus) { text-overflow: clip; }
@media (prefers-reduced-motion: no-preference) {
  .overflowing:is(:hover, :focus) > span { animation: read-title var(--duration) .3s ease-in-out 2 alternate; }
  @keyframes read-title { 80%, 100% { transform: translateX(var(--travel)); } }
}
@media (prefers-reduced-motion: reduce) {
  .overflowing:is(:hover, :focus) { overflow-x: auto; }
}
</style>
