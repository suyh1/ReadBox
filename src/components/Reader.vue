<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clock3,
  List,
  Search,
  NotebookPen,
  Settings2,
  X,
  Highlighter,
  Maximize,
  Volume2,
} from '@lucide/vue'
import type { Book, Contents, Location, Rendition } from 'epubjs'
import type Section from 'epubjs/types/section'
import { openingPosition, scheduleUpload, syncError } from '../reader/sync'
import { duration, useReadingTime } from '../reader/reading-time'
import SyncSettings from './SyncSettings.vue'
import MarqueeTitle from './MarqueeTitle.vue'
import { ExtensionChapterView } from '../reader/extension-view'
import {
  closeBook,
  contentsOf,
  openBook,
  resolveLink,
  searchChapter,
  spineOf,
  type Match,
} from '../reader/epub'
import { readFile, updateBook, type Mark, type ShelfBook } from '../reader/library'

const props = defineProps<{ record: ShelfBook }>()
const emit = defineEmits<{ close: [] }>()
const viewport = ref<HTMLElement>()
const backButton = ref<HTMLButtonElement>()
const dialog = ref<HTMLDialogElement>()
const panel = ref('')
const loading = ref(true)
const error = ref('')
const status = ref('')
const { elapsed, start: startTimer } = useReadingTime(props.record.id, () => {
  status.value = '阅读时长保存失败，请检查存储空间。'
})
let firstLocation = true
let positionTime = 0
const focus = ref(false)
const location = ref<Location>()
const spreadVisible = ref(false)
const chapter = ref('')
const percent = ref(0)
const beforeJump = ref('')
let foundCfi = ''
const toc = ref<ReturnType<typeof contentsOf>>([])
const folded = ref(new Set<number>())
const visibleToc = computed(() => {
  let hiddenBelow = Infinity
  return toc.value.flatMap((entry, index) => {
    if (entry.depth > hiddenBelow) return []
    hiddenBelow = folded.value.has(index) ? entry.depth : Infinity
    return [{ ...entry, index }]
  })
})
function toggleVolume(index: number) {
  if (folded.value.has(index)) folded.value.delete(index)
  else folded.value.add(index)
}
const marks = ref<Mark[]>(props.record.marks.map((m) => ({ ...m })))
const selection = ref<Pick<Mark, 'cfi' | 'quote' | 'chapter'>>()
const note = ref('')
const footnote = ref('')
const query = ref('')
const results = ref<Match[]>([])
const searchState = ref('')
const speak = ref(false)
const voices = ref<SpeechSynthesisVoice[]>([])
const synth = window.speechSynthesis
let book: Book | undefined
let rendition: Rendition | undefined
let sections: Section[] = []
let disposed = false
let searchRun = 0
let utterance: SpeechSynthesisUtterance | undefined
let lastAnchor: Element | null = null

const android = /Android/i.test(navigator.userAgent)
const desktopPages = !!window.readbox || (!android && !/iPad|iPhone|Mobile/i.test(navigator.userAgent))
const minSpreadWidth = 800

const defaults = {
  theme: '跟随系统',
  width: '标准',
  size: 100,
  font: '书籍原样',
  spacing: '原书',
  flow: 'paginated',
}
function readPreferences() {
  try {
    const saved = { ...defaults, ...JSON.parse(localStorage.getItem('reader-preferences') || '{}') }
    if (!desktopPages && saved.flow === 'two-page') saved.flow = 'paginated'
    return saved as typeof defaults
  } catch {
    return { ...defaults }
  }
}
const prefs = ref(readPreferences())
const twoPage = computed(() => desktopPages && prefs.value.flow === 'two-page')
const spread = computed(() => twoPage.value ? 'auto' : 'none')
const flow = computed(() => prefs.value.flow === 'scrolled-doc' ? 'scrolled-doc' : 'paginated')
const maxReadingWidth = computed(() => {
  const pageWidth = prefs.value.width === '窄幅' ? 650 : prefs.value.width === '宽幅' ? 1080 : 850
  return pageWidth * (twoPage.value ? 2 : 1)
})
const visiblePages = computed(() => {
  const loc = location.value
  if (!loc) return ''
  const first = loc.start.displayed.page
  const last = loc.end.displayed.page
  return twoPage.value && loc.start.index === loc.end.index && last > first ? first + '–' + last : first
})
const palettes: Record<string, string[]> = {
  纸白: ['#fcfbf8', '#292a2e'],
  暖纸: ['#eee2cb', '#43392b'],
  夜读: ['#22242a', '#e5e4df'],
}
const appearance = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(appearance.matches)
function updateAppearance() {
  systemDark.value = appearance.matches
}
const theme = computed(() =>
  prefs.value.theme === '跟随系统' ? (systemDark.value ? '夜读' : '纸白') : prefs.value.theme,
)
const colors = computed(() => palettes[theme.value] || palettes['纸白'])
const bookmarked = computed(() =>
  marks.value.some((m) => m.kind === 'bookmark' && m.cfi === location.value?.start.cfi),
)
const tools = [
  { name: '目录', icon: List },
  { name: '书内搜索', icon: Search },
  { name: '书摘', icon: NotebookPen },
  { name: '阅读设置', icon: Settings2 },
]
function clearStatus() {
  error.value = ''
  status.value = ''
}
function resetSearch() {
  searchRun++
  results.value = []
  searchState.value = ''
}
function labelFor(index: number) {
  const section = sections[index]
  return toc.value.find((t) => t.href.split('#')[0] === section?.href)?.label || '第 ' + (index + 1) + ' 章'
}
function showPanel(name: string) {
  focus.value = false
  panel.value = name
  if (!dialog.value?.open) {
    if (window.location.protocol === 'moz-extension:' && window.location.hash !== '#tools') {
      history.pushState({ tools: true }, '', '#tools')
    }
    dialog.value?.showModal()
  }
  if (name === '书内搜索' || name === '写笔记') {
    void nextTick(() => dialog.value?.querySelector<HTMLElement>('input[type=search], textarea')?.focus())
  }
}
function dismissTool() {
  if (dialog.value?.open) {
    dialog.value.close()
    return true
  }
  if (selection.value) {
    selection.value = undefined
    return true
  }
  if (focus.value) {
    focus.value = false
    return true
  }
  return false
}
defineExpose({ dismissTool })
function afterDialog() {
  if (panel.value === '脚注') (lastAnchor as HTMLElement | null)?.focus?.({ preventScroll: true })
  panel.value = ''
  if (window.location.hash === '#tools') history.back()
}
function stopSpeaking() {
  if (speak.value) synth?.cancel()
  speak.value = false
  utterance = undefined
}
function refreshVoices() {
  voices.value = synth?.getVoices().filter((v) => v.localService) || []
}
function readAloud() {
  if (speak.value) {
    stopSpeaking()
    return
  }
  const start = location.value?.start
  if (!start || !rendition || !voices.value.length) return
  const content = (rendition.getContents() as unknown as Contents[])[0]
  if (!content) return
  const range = content.document.createRange()
  range.selectNodeContents(content.content)
  const here = content.range(start.cfi)
  if (here) range.setStart(here.startContainer, here.startOffset)
  const chunks = range.toString().match(/[^。！？.!?\n]{1,140}[。！？.!?]?/gu) || []
  const language = book?.packaging.metadata.language || 'zh'
  const voice = voices.value.find((v) => v.lang.startsWith(language.split('-')[0])) || voices.value[0]
  let index = 0
  function next() {
    if (!speak.value || index >= chunks.length) {
      stopSpeaking()
      return
    }
    const line = new SpeechSynthesisUtterance(chunks[index++])
    utterance = line
    line.voice = voice
    line.onend = () => {
      if (utterance === line) next()
    }
    line.onerror = () => {
      if (utterance === line) {
        stopSpeaking()
        status.value = '系统语音不可用。'
      }
    }
    synth.speak(line)
  }
  speak.value = true
  dialog.value?.close()
  next()
}
function applyStyle(content: Contents) {
  const p = prefs.value
  const family = p.font === '宋体' ? 'serif' : p.font === '黑体' ? 'sans-serif' : ''
  const night = theme.value === '夜读'
  const css =
    'html,body{background:' +
    colors.value[0] +
    ' !important;color:' +
    colors.value[1] +
    ' !important}' +
    (p.size !== 100 ? 'html{font-size:' + p.size + '% !important}body{font-size:1rem !important}' : '') +
    (family ? 'body,p{font-family:' + family + ' !important}' : '') +
    (p.spacing !== '原书'
      ? 'body,p,li{line-height:' + (p.spacing === '舒展' ? '1.95' : '1.55') + ' !important}'
      : '') +
    (night
      ? 'body :is(p,span,div,h1,h2,h3,h4,li,td,a){color:inherit !important;background-color:transparent !important}'
      : '') +
    'img,svg{max-width:100%}'
  void content.addStylesheetCss(css, 'readbox-preferences')
}
watch(
  [prefs, systemDark],
  ([value]) => {
    try {
      localStorage.setItem('reader-preferences', JSON.stringify(value))
    } catch {
      status.value = '排版偏好未能保存。'
    }
    if (rendition) {
      const current = location.value?.start.cfi
      if (rendition.settings.spread !== spread.value) rendition.spread(spread.value, minSpreadWidth)
      if (rendition.settings.flow !== flow.value) rendition.flow(flow.value)
      for (const c of rendition.getContents() as unknown as Contents[]) applyStyle(c)
      if (current)
        void rendition.display(current).catch(() => {
          error.value = '无法恢复阅读位置。'
        })
    }
  },
  { deep: true, flush: 'post' },
)
function relocated(loc: Location) {
  if (disposed || !loc.start?.cfi) return
  if (location.value?.start.index !== loc.start.index) stopSpeaking()
  const moved = !firstLocation && location.value?.start.cfi !== loc.start.cfi
  if (firstLocation) startTimer()
  firstLocation = false
  location.value = loc
  chapter.value = labelFor(loc.start.index)
  const { page, total } = loc.start.displayed
  const progress = loc.atEnd
    ? 100
    : Math.min(99, Math.floor((100 * (loc.start.index + (page - 1) / Math.max(total, 1))) / sections.length))
  percent.value = progress
  const patch = { cfi: loc.start.cfi, chapter: chapter.value, progress, lastRead: Date.now() }
  void updateBook(props.record.id, b => {
    Object.assign(b, patch)
    if (moved) {
      positionTime = Math.max(Date.now(), positionTime + 1, (b.pendingPosition?.updated || 0) + 1)
      b.pendingPosition = {
        id: b.id, cfi: patch.cfi, chapter: patch.chapter, progress,
        updated: positionTime,
      }
    }
  }).then(() => { if (moved) scheduleUpload(disposed ? 'leave' : 'interval') }).catch(() => {
    status.value = '阅读位置保存失败，请检查存储空间。'
  })
}
async function jump(target: string, searchHit = false, remember = true) {
  if (remember && location.value) beforeJump.value = location.value.start.cfi
  if (foundCfi) rendition?.annotations.remove(foundCfi, 'underline')
  foundCfi = searchHit ? target : ''
  if (searchHit)
    rendition?.annotations.underline(target, {}, undefined, 'readbox-search', {
      stroke: '#b98125',
      'stroke-width': '2',
    })
  dialog.value?.close()
  selection.value = undefined
  error.value = ''
  try {
    await rendition?.display(target)
  } catch {
    error.value = '此位置无法打开，请从目录选择其他章节。'
  }
}
function undoJump() {
  const previous = beforeJump.value
  beforeJump.value = ''
  void jump(previous, false, false)
}
function turn(next: boolean) {
  if (loading.value || dialog.value?.open || !rendition) return
  selection.value = undefined
  void (next ? rendition.next() : rendition.prev()).catch(() => {
    error.value = '翻页失败，请从目录重新定位。'
  })
}
function keys(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    dialog.value?.open ||
    (event.target as HTMLElement)?.closest?.('input,textarea,select')
  )
    return
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault()
      showPanel('书内搜索')
    }
    return
  }
  if (event.altKey || event.shiftKey) return
  if (event.key === 'Escape') {
    if (!dismissTool()) emit('close')
    return
  }
  if (['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp'].includes(event.key)) {
    event.preventDefault()
    turn(event.key === 'ArrowRight' || event.key === 'PageDown')
  }
}
async function followLink(anchor: Element, source: Contents) {
  const section = sections[source.sectionIndex]
  const target = resolveLink(section.href, anchor.getAttribute('href') || '')
  if (!target || !book?.spine.get(target)) {
    status.value = '该链接指向书外或缺失的章节。'
    return
  }
  const [href, fragment] = target.split('#')
  if (
    fragment &&
    (anchor.matches('.duokan-footnote,[role="doc-noteref"]') ||
      anchor.getAttribute('epub:type')?.split(/\s+/).includes('noteref'))
  ) {
    const doc =
      href === section.href ? source.document : ((await book.load(book.spine.get(target).url)) as Document)
    const text = doc.getElementById(decodeURIComponent(fragment))?.textContent?.trim()
    if (text && !disposed) {
      footnote.value = text
      lastAnchor = anchor
      showPanel('脚注')
      return
    }
  }
  await jump(target)
}
function bindContent(content: Contents) {
  applyStyle(content)
  const doc = content.document
  doc.defaultView?.frameElement?.setAttribute('title', labelFor(content.sectionIndex))
  doc.addEventListener('keydown', keys)
  let touchX = 0,
    touchY = 0,
    swipeAt = 0
  doc.addEventListener(
    'touchstart',
    (e) => {
      touchX = e.touches[0].clientX
      touchY = e.touches[0].clientY
    },
    { passive: true },
  )
  doc.addEventListener(
    'touchend',
    (e) => {
      const dx = e.changedTouches[0].clientX - touchX
      if (
        flow.value === 'paginated' &&
        !doc.getSelection()?.toString() &&
        Math.abs(dx) > 55 &&
        Math.abs(dx) > Math.abs(e.changedTouches[0].clientY - touchY) * 1.6
      ) {
        swipeAt = Date.now()
        turn(dx < 0)
      }
    },
    { passive: true },
  )
  doc.addEventListener(
    'click',
    (event) => {
      const anchor = (event.target as Element).closest?.('a')
      if (anchor) {
        event.preventDefault()
        event.stopImmediatePropagation()
        void followLink(anchor, content).catch(() => {
          status.value = '此链接无法打开。'
        })
        return
      }
      if (doc.getSelection()?.toString() || Date.now() - swipeAt < 400) return
      selection.value = undefined
      if (window.matchMedia('(pointer: coarse)').matches && flow.value === 'paginated') {
        const x = event.clientX / content.window.innerWidth
        if (x < 0.22 || x > 0.78) {
          turn(x > 0.78)
          return
        }
      }
      focus.value = !focus.value
    },
    true,
  )
}
function highlight(mark: Mark) {
  rendition?.annotations.highlight(mark.cfi, {}, () => edit(mark), 'readbox-highlight', {
    fill: '#d6aa42',
    'fill-opacity': '0.45',
  })
}
function edit(mark: Mark) {
  selection.value = { cfi: mark.cfi, quote: mark.quote, chapter: mark.chapter }
  note.value = mark.note
  showPanel('写笔记')
}
async function saveMark(mark: Mark, remove = false) {
  // Vue proxies cannot be stored by IndexedDB.
  const plain = { ...mark }
  try {
    const apply = (list: Mark[]) => {
      const rest = list.filter((m) => m.kind !== plain.kind || m.cfi !== plain.cfi)
      return remove ? rest : [...rest, plain]
    }
    await updateBook(props.record.id, (b) => {
      b.marks = apply(b.marks)
    })
    if (disposed) return
    const existed = marks.value.some((m) => m.kind === plain.kind && m.cfi === plain.cfi)
    marks.value = apply(marks.value)
    if (plain.kind === 'highlight') {
      if (existed) rendition?.annotations.remove(plain.cfi, 'highlight')
      if (!remove) highlight(plain)
    }
    status.value = remove ? '已移除' : '已保存'
    selection.value = undefined
    if (panel.value === '写笔记') dialog.value?.close()
  } catch {
    status.value = '保存失败，请检查本机存储空间。'
  }
}
function bookmark() {
  if (location.value)
    void saveMark(
      { kind: 'bookmark', cfi: location.value.start.cfi, chapter: chapter.value, quote: '', note: '' },
      bookmarked.value,
    )
}
function saveHighlight(withNote: boolean) {
  if (!selection.value) return
  const existing = marks.value.find((m) => m.kind === 'highlight' && m.cfi === selection.value!.cfi)
  void saveMark({
    kind: 'highlight',
    ...selection.value,
    note: withNote ? note.value : existing?.note || '',
  })
}
async function search() {
  const run = ++searchRun
  const term = query.value.trim()
  results.value = []
  searchState.value = ''
  if (!term || !book) return
  let skipped = 0
  for (const section of sections) {
    if (disposed || run !== searchRun) return
    searchState.value = '正在搜索 ' + (section.index + 1) + ' / ' + sections.length
    try {
      const matches = await searchChapter(
        book,
        section,
        term,
        200 - results.value.length,
        labelFor(section.index),
      )
      if (disposed || run !== searchRun) return
      results.value.push(...matches)
    } catch {
      skipped++
    }
    if (results.value.length >= 200) break
  }
  if (run === searchRun)
    searchState.value =
      (results.value.length === 200 ? '显示前 200 条结果' : '找到 ' + results.value.length + ' 处') +
      (skipped ? '，部分章节无法读取' : '')
}
const exportText = computed(
  () =>
    '# ' +
    props.record.title +
    '\n\n' +
    marks.value
      .map(
        (m) =>
          '## ' +
          m.chapter +
          '\n\n' +
          (m.kind === 'bookmark' ? '书签' : '> ' + m.quote + (m.note ? '\n\n' + m.note : '')),
      )
      .join('\n\n'),
)
function downloadNotes() {
  const url = URL.createObjectURL(new Blob([exportText.value], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = props.record.title + '-书摘.md'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
async function copyNotes() {
  try {
    await navigator.clipboard.writeText(exportText.value)
    status.value = '书摘已复制'
    dialog.value?.close()
  } catch {
    showPanel('导出书摘')
  }
}
onMounted(async () => {
  appearance.addEventListener('change', updateAppearance)
  window.addEventListener('keydown', keys)
  refreshVoices()
  synth?.addEventListener('voiceschanged', refreshVoices)
  try {
    const opened = await openBook(await (await readFile(props.record.id)).arrayBuffer())
    if (disposed) {
      closeBook(opened)
      return
    }
    book = opened
    sections = spineOf(book)
    toc.value = contentsOf(book, sections)
    rendition = book.renderTo(viewport.value!, {
      width: '100%',
      height: '100%',
      flow: flow.value,
      spread: spread.value,
      minSpreadWidth,
      allowScriptedContent: false,
      ...(window.location.protocol === 'moz-extension:' ? { view: ExtensionChapterView } : {}),
    })
    rendition.hooks.content.register(bindContent)
    rendition.on('layout', (layout: { divisor: number }) => {
      spreadVisible.value = layout.divisor === 2
    })
    rendition.on('relocated', relocated)
    rendition.on('displayerror', (cause: unknown) => {
      console.warn('无法载入 EPUB 章节', cause)
      loading.value = false
      error.value = '本章无法载入，请从目录打开其他章节。'
    })
    rendition.on('selected', (cfi: string, contents: Contents) => {
      const quote = contents.window.getSelection()?.toString().trim()
      if (quote) {
        selection.value = { cfi, quote, chapter: labelFor(contents.sectionIndex) }
        note.value = ''
        focus.value = false
      }
    })
    marks.value.filter((m) => m.kind === 'highlight').forEach(highlight)
    let target: string | undefined
    try {
      const remote = await openingPosition(props.record.id, props.record.pendingPosition)
      target = remote?.cfi
      positionTime = remote?.updated || 0
    } catch (cause) {
      status.value = syncError(cause) + ' 已从书首打开。'
    }
    if (disposed) return
    try {
      await rendition.display(target)
    } catch {
      status.value = '云端位置无法定位，已从书首打开。'
      await rendition.display()
    }
    if (!disposed) backButton.value?.focus({ preventScroll: true })
  } catch {
    error.value = '无法打开这本书，请返回书架后重试。'
  } finally {
    loading.value = false
  }
})
onBeforeUnmount(() => {
  disposed = true
  scheduleUpload('leave')
  searchRun++
  stopSpeaking()
  synth?.removeEventListener('voiceschanged', refreshVoices)
  appearance.removeEventListener('change', updateAppearance)
  window.removeEventListener('keydown', keys)
  if (book) closeBook(book)
})
</script>

<template>
  <main
    class="reader"
    :class="{ focused: focus, night: theme === '夜读' }"
    :style="{ '--paper': colors[0], '--print': colors[1] }"
  >
    <header class="reader-bar">
      <button ref="backButton" class="quiet" @click="emit('close')">
        <ArrowLeft />
        书架
      </button>
      <button v-if="beforeJump" class="quiet return-position" @click="undoJump">返回跳转前</button>
      <MarqueeTitle :text="record.title" />
      <button class="icon" title="阅读时长" aria-label="阅读时长" @click="showPanel('阅读时长')"><Clock3 /></button>
      <button class="icon" title="专注阅读" aria-label="专注阅读" @click="focus = true"><Maximize /></button>
    </header>
    <div class="reading-area" :class="{ spread: spreadVisible }" :style="{ maxWidth: maxReadingWidth + 'px' }">
      <div ref="viewport" class="viewport"></div>
      <p v-if="loading" role="status" class="reader-message">正在排版…</p>
    </div>
    <div v-if="error || status" class="reader-status" role="status">
      {{ error || status }}
      <button class="icon" aria-label="关闭提示" @click="clearStatus">
        <X />
      </button>
    </div>
    <button v-if="focus" class="focus-exit" @click="focus = false">退出专注</button>
    <div v-if="selection && !panel" class="selection-tools">
      <button @click="saveHighlight(false)">
        <Highlighter />
        划线
      </button>
      <button @click="showPanel('写笔记')">
        <NotebookPen />
        写笔记
      </button>
      <button class="icon" aria-label="取消选择" @click="selection = undefined"><X /></button>
    </div>
    <footer class="reader-footer">
      <div class="page-info">
        <button
          class="icon"
          title="上一页"
          aria-label="上一页"
          :disabled="!location || location.atStart"
          @click="turn(false)"
        >
          <ChevronLeft />
        </button>
        <span>
          {{ chapter }}
          <small v-if="location">
            {{ visiblePages }} / {{ location.start.displayed.total }} · {{ percent }}%
          </small>
        </span>
        <button class="icon" title="下一页" aria-label="下一页" :disabled="!location || location.atEnd" @click="turn(true)">
          <ChevronRight />
        </button>
      </div>
      <nav class="reader-tools" aria-label="阅读工具">
        <button v-for="tool in tools" :key="tool.name" @click="showPanel(tool.name)">
          <component :is="tool.icon" />
          {{ tool.name }}
        </button>
        <button :disabled="!location" :aria-pressed="bookmarked" @click="bookmark">
          <Bookmark />
          {{ bookmarked ? '已加书签' : '加书签' }}
        </button>
      </nav>
    </footer>
    <dialog ref="dialog" class="reader-dialog" :aria-label="panel" @close="afterDialog">
      <header>
        <h2>{{ panel }}</h2>
        <button class="icon" aria-label="关闭面板" @click="dialog?.close()"><X /></button>
      </header>
      <dl v-if="panel === '阅读时长'" class="time-stats">
        <dt>本次阅读</dt><dd>{{ duration(elapsed) }}</dd>
        <dt>本书累计</dt><dd>{{ duration((record.readingMs || 0) + elapsed) }}</dd>
      </dl>
      <div v-if="panel === '目录'" class="toc-list">
        <div v-for="t in visibleToc" :key="t.index" class="toc-row"
          :style="{ paddingInlineStart: Math.min(t.depth, 6) * 0.8 + 'rem' }">
          <button v-if="t.hasChildren" class="toc-group" :aria-expanded="!folded.has(t.index)"
            @click="toggleVolume(t.index)">
            <ChevronRight />{{ t.label }}
          </button>
          <button v-if="t.href" :class="t.hasChildren ? 'icon toc-jump' : 'toc-chapter'"
            :aria-label="t.hasChildren ? '跳转到' + t.label : undefined"
            :aria-current="location?.start.href === t.href.split('#')[0] ? 'location' : undefined"
            @click="jump(t.href)">
            <BookOpen v-if="t.hasChildren" /><template v-else>{{ t.label }}</template>
          </button>
        </div>
      </div>
      <template v-if="panel === '书内搜索'">
        <form class="search-form" @submit.prevent="search">
          <input
            v-model="query"
            type="search"
            placeholder="搜索全书正文"
            aria-label="搜索全书正文"
            @input="resetSearch"
          />
          <button class="primary">搜索</button>
        </form>
        <p role="status">{{ searchState }}</p>
        <div class="entries">
          <button v-for="r in results" :key="r.cfi" @click="jump(r.cfi, true)">
            <small>{{ r.chapter }}</small>
            {{ r.excerpt }}
          </button>
        </div>
      </template>
      <template v-if="panel === '书摘'">
        <p v-if="!marks.length">还没有书摘。选中正文即可划线或写笔记，也可以在阅读工具栏添加书签。</p>
        <article v-for="m in marks" :key="m.kind + m.cfi" class="mark">
          <small>{{ m.kind === 'bookmark' ? '书签' : '划线' }} · {{ m.chapter }}</small>
          <p v-if="m.quote">{{ m.quote }}</p>
          <p v-if="m.note">{{ m.note }}</p>
          <button @click="jump(m.cfi)">回到原文</button>
          <button v-if="m.kind === 'highlight'" @click="edit(m)">编辑笔记</button>
          <button @click="saveMark(m, true)">移除</button>
        </article>
        <button v-if="marks.length" @click="android ? copyNotes() : downloadNotes()">
          {{ android ? '复制 Markdown' : '导出 Markdown' }}
        </button>
      </template>
      <template v-if="panel === '导出书摘'">
        <label>
          长按可复制全部书摘
          <textarea
            readonly
            :value="exportText"
            @focus="($event.target as HTMLTextAreaElement).select()"
          ></textarea>
        </label>
      </template>
      <template v-if="panel === '写笔记'">
        <blockquote>{{ selection?.quote }}</blockquote>
        <label>
          我的笔记
          <textarea v-model="note" rows="4" placeholder="记下此刻的想法"></textarea>
        </label>
        <button class="primary" @click="saveHighlight(true)">保存笔记</button>
      </template>
      <p v-if="panel === '脚注'" class="footnote">{{ footnote }}</p>
      <div v-if="panel === '阅读设置'" class="preferences">
        <fieldset>
          <legend>纸张</legend>
          <button
            v-for="name in ['跟随系统', ...Object.keys(palettes)]"
            :key="name"
            :aria-pressed="prefs.theme === name"
            @click="prefs.theme = String(name)"
          >
            {{ name }}
          </button>
        </fieldset>
        <label>
          字号
          <input v-model.number="prefs.size" type="range" min="75" max="180" step="5" />
          {{ prefs.size }}%
        </label>
        <label>
          字体
          <select v-model="prefs.font" aria-label="字体">
            <option>书籍原样</option>
            <option>宋体</option>
            <option>黑体</option>
          </select>
        </label>
        <label>
          版心宽度
          <select v-model="prefs.width" aria-label="版心宽度">
            <option>窄幅</option>
            <option>标准</option>
            <option>宽幅</option>
          </select>
        </label>
        <label>
          行距
          <select v-model="prefs.spacing" aria-label="行距">
            <option>原书</option>
            <option>紧凑</option>
            <option>舒展</option>
          </select>
        </label>
        <label>
          阅读方式
          <select v-model="prefs.flow" aria-label="阅读方式">
            <option value="paginated">{{ desktopPages ? '单栏分页' : '左右分页' }}</option>
            <option v-if="desktopPages" value="two-page">双栏分页</option>
            <option value="scrolled-doc">章节内滚动</option>
          </select>
        </label>
        <small v-if="twoPage && !spreadVisible && location">窗口宽度达到 {{ minSpreadWidth }} 像素时显示双栏。</small>
        <details><summary>WebDAV 进度同步</summary><SyncSettings /></details>
        <button :disabled="!voices.length" @click="readAloud">
          <Volume2 />
          {{ speak ? '停止朗读' : voices.length ? '从这里朗读本章' : '系统暂无离线语音' }}
        </button>
      </div>
    </dialog>
  </main>
</template>
