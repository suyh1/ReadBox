import { onBeforeUnmount, onMounted, ref } from 'vue'
import { updateBook } from './library'

export function duration(ms: number) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return hours ? hours + ' 小时 ' + minutes % 60 + ' 分钟'
    : minutes ? minutes + ' 分 ' + seconds % 60 + ' 秒' : seconds + ' 秒'
}

export function useReadingTime(id: string, onFailure: () => void) {
  const elapsed = ref(0)
  let started: number | undefined
  let ready = false
  let persisted = 0
  let interval = 0
  let desktopActive = false
  let stopObserving: (() => void) | undefined
  function tick() {
    if (started === undefined) return
    const now = performance.now()
    elapsed.value += now - started
    started = now
  }
  function save() {
    const delta = Math.floor(elapsed.value) - persisted
    if (delta <= 0) return
    persisted += delta
    void updateBook(id, book => { book.readingMs = (book.readingMs || 0) + delta }).catch(() => {
      persisted -= delta
      onFailure()
    })
  }
  function visibility() {
    tick()
    if (ready && !document.hidden && (window.readbox ? desktopActive : document.hasFocus())) started = performance.now()
    else { started = undefined; save() }
  }
  function pause() {
    tick()
    started = undefined
    save()
  }
  onMounted(() => {
    stopObserving = window.readbox?.onWindowActivity(active => {
      desktopActive = active
      visibility()
    })
    interval = window.setInterval(() => {
      tick()
      if (elapsed.value - persisted >= 5000) save()
    }, 1000)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('focus', visibility)
    window.addEventListener('blur', visibility)
    window.addEventListener('pagehide', pause)
    window.addEventListener('pageshow', visibility)
  })
  onBeforeUnmount(() => {
    pause()
    stopObserving?.()
    clearInterval(interval)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('focus', visibility)
    window.removeEventListener('blur', visibility)
    window.removeEventListener('pagehide', pause)
    window.removeEventListener('pageshow', visibility)
  })
  return { elapsed, start() { ready = true; visibility() } }
}
