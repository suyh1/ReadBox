<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import {
  BookOpen,
  LibraryBig,
  Heart,
  Clock3,
  FolderPlus,
  Search,
  ArrowRight,
  Trash2,
  Settings2,
  Cloud,
  X,
} from '@lucide/vue'
import BookCover from './components/BookCover.vue'
import DisplaySettings from './components/DisplaySettings.vue'
import SyncSettings from './components/SyncSettings.vue'
import Reader from './components/Reader.vue'
import MarqueeTitle from './components/MarqueeTitle.vue'
import './library.css'
import { listBooks, removeBook, updateBook, type ShelfBook } from './reader/library'
import { scheduleUpload } from './reader/sync'
import { importBook } from './reader/epub'
import sample from './assets/书页之间.epub?inline&url'

const desktop = window.readbox
const extensionHost = window.location.protocol === 'moz-extension:'
const books = ref<ShelfBook[]>([])
const active = ref<ShelfBook>()
const reader = ref<InstanceType<typeof Reader>>()
const picker = ref<HTMLInputElement>()
const collection = ref<HTMLElement>()
const busy = ref(false)
const loaded = ref(false)
const notice = ref('')
const query = ref('')
const scope = ref('全部图书')
const order = ref('最近阅读')
const modal = ref<HTMLDialogElement>()
const syncSettings = ref(false)
const deleting = ref<ShelfBook>()
const featured = computed(
  () => [...books.value].sort((a, b) => b.lastRead - a.lastRead || b.added - a.added)[0],
)
const filters = [
  { name: '全部图书', icon: LibraryBig },
  { name: '正在阅读', icon: Clock3 },
  { name: '我的收藏', icon: Heart },
]
const visible = computed(() =>
  books.value
    .filter((b) => {
      if (scope.value === '我的收藏' && !b.favorite) return false
      if (scope.value === '正在阅读' && (!b.lastRead || b.progress === 100)) return false
      return (b.title + ' ' + b.author).toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
    })
    .sort((a, b) =>
      order.value === '书名'
        ? a.title.localeCompare(b.title, 'zh-CN')
        : order.value === '导入时间'
          ? b.added - a.added
          : b.lastRead - a.lastRead || b.added - a.added,
    ),
)

async function refresh() {
  try {
    books.value = await listBooks()
    loaded.value = true
  } catch {
    notice.value = '无法读取本机书架，请检查可用存储空间后重试。'
  }
}
async function ingest(files: File[], openAfter = false) {
  if (busy.value || !files.length) return
  busy.value = true
  notice.value = ''
  let added = 0,
    duplicates = 0
  const failures: string[] = []
  let lastId = ''
  for (const file of files) {
    try {
      const item = await importBook(file)
      lastId = item.id
      if (item.added) added++
      else duplicates++
    } catch (error) {
      failures.push(
        file.name +
          (error instanceof DOMException && error.name === 'QuotaExceededError'
            ? '（存储空间不足）'
            : '（无法读取，请选择有效的无 DRM EPUB）'),
      )
    }
  }
  await refresh()
  notice.value = [added && '已加入 ' + added + ' 本', duplicates && duplicates + ' 本已在书架', ...failures]
    .filter(Boolean)
    .join(' · ')
  busy.value = false
  if (openAfter && lastId) {
    const book = books.value.find((b) => b.id === lastId)
    if (book) openReader(book)
  }
}
function choose(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  void ingest(files, files.length === 1)
}
function windowTop() {
  window.scrollTo({ top: 0 })
}
async function startSample() {
  const bytes = Uint8Array.from(atob(sample.split(',')[1]), (c) => c.charCodeAt(0))
  await ingest([new File([bytes], '书页之间.epub')], true)
}
function openReader(book: ShelfBook) {
  if (extensionHost) {
    const target = new URL(window.location.href)
    target.searchParams.set('book', book.id)
    window.location.assign(target.href)
    return
  }
  active.value = book
  notice.value = ''
  history.pushState({ book: book.id }, '')
}
function backToShelf() {
  if (extensionHost) window.location.replace(window.location.pathname)
  else history.back()
}
function handleBack(event: PopStateEvent) {
  if (extensionHost) {
    reader.value?.dismissTool()
    return
  }
  if (event.state?.book && !active.value) {
    active.value = books.value.find((b) => b.id === event.state.book)
    return
  }
  if (active.value && reader.value?.dismissTool()) {
    history.pushState({ book: active.value.id }, '')
    return
  }
  active.value = undefined
  void nextTick(refresh)
}
async function showDialog(book?: ShelfBook, sync = false) {
  syncSettings.value = sync
  deleting.value = book
  await nextTick()
  modal.value?.showModal()
}
async function erase() {
  if (!deleting.value) return
  try {
    await removeBook(deleting.value.id)
    await refresh()
    modal.value?.close()
  } catch {
    notice.value = '移除失败，请重试。'
    modal.value?.close()
  }
}
async function toggleFavorite(book: ShelfBook) {
  try {
    await updateBook(book.id, (b) => {
      b.favorite = !b.favorite
    })
    await refresh()
  } catch {
    notice.value = '收藏保存失败，请重试。'
  }
}
async function restorePage() {
  await refresh()
  if (extensionHost) {
    const id = new URL(window.location.href).searchParams.get('book')
    active.value = books.value.find(book => book.id === id)
    // GeckoView uses separate documents for the reader and shelf, including
    // native Back. Run the leave upload in the surviving shelf document.
    if (active.value) sessionStorage.setItem('readbox-in-reader', '1')
    else if (sessionStorage.getItem('readbox-in-reader')) {
      sessionStorage.removeItem('readbox-in-reader')
      scheduleUpload('leave')
    }
  }
}
function pageShown(event: PageTransitionEvent) {
  if (event.persisted) void restorePage()
}
onMounted(() => {
  void restorePage()
  window.addEventListener('pageshow', pageShown)
  window.addEventListener('popstate', handleBack)
})
onUnmounted(() => {
  window.removeEventListener('popstate', handleBack)
  window.removeEventListener('pageshow', pageShown)
})
</script>

<template>
  <Reader v-if="active" ref="reader" :record="active" @close="backToShelf" />
  <div
    v-else
    class="library"
    @dragover.prevent
    @drop.prevent="ingest(Array.from($event.dataTransfer?.files || []))"
  >
    <header class="topbar">
      <div class="topinner">
        <button class="brand" aria-label="返回书房顶部" @click="windowTop">
          <BookOpen :size="25" />
          <strong>ReadBox</strong>
        </button>
        <nav aria-label="书房导航">
          <button class="quiet" @click="collection?.scrollIntoView()">书架</button>
        </nav>
        <button class="icon" aria-label="进度同步" title="进度同步" @click="showDialog(undefined, true)"><Cloud /></button>
        <button v-if="desktop" class="icon" :disabled="busy" aria-label="桌面设置" @click="showDialog()"><Settings2 /></button>
      </div>
    </header>
    <main class="shelf">
      <div class="heading">
        <h1 id="ready">我的书房</h1>
      </div>
      <input ref="picker" type="file" multiple accept=".epub,application/epub+zip" hidden @change="choose" />
      <p v-if="notice" role="status" class="notice">
        {{ notice }}
        <button class="icon" aria-label="关闭提示" @click="notice = ''"><X /></button>
      </p>
      <div class="shelf-bento">
        <section v-if="loaded" class="feature">
          <div class="feature-copy">
            <span class="kicker">
              <BookOpen :size="15" />
              {{ featured ? (featured.lastRead ? '继续阅读' : '最近加入') : '内置试读' }}
            </span>
            <h2><MarqueeTitle :text="featured?.title || '书页之间'" /></h2>
            <p>{{ featured ? featured.author : '三篇关于阅读的短随笔' }}</p>
            <small v-if="featured?.lastRead">
              {{ featured.chapter }} · {{ featured.progress }}%<span v-if="featured.marks.length"> · {{ featured.marks.length }} 条书摘</span>
            </small>
            <button
              :disabled="busy"
              class="feature-action"
              @click="featured ? openReader(featured) : startSample()"
            >
              {{ featured?.lastRead ? '接着读' : '开始阅读' }}
              <ArrowRight :size="17" />
            </button>
          </div>
          <div class="feature-art">
            <BookCover :title="featured?.title || '书页之间'" :cover="featured?.cover" />
          </div>
        </section>
        <div v-else class="feature-placeholder" role="status">
          <span>{{ notice ? '无法读取本机书架' : '正在读取书架…' }}</span>
          <i v-if="!notice" aria-hidden="true"></i>
          <button v-else @click="refresh">重试</button>
        </div>
        <button class="import-tile" :disabled="busy" @click="picker?.click()">
          <span class="import-art" aria-hidden="true"><FolderPlus /></span>
          <strong>{{ busy ? '正在导入…' : '导入 EPUB' }}</strong>
          <small>选择文件或拖入书房</small>
        </button>
      </div>
      <section ref="collection" class="collection" aria-label="本地书架">
        <div class="collection-head">
          <h2>
            书架
            <small>{{ books.length }} 本</small>
          </h2>
          <div class="search">
            <Search />
            <input v-model="query" type="search" placeholder="搜索书名或作者" aria-label="搜索书名或作者" />
          </div>
        </div>
        <div class="shelf-tools">
          <nav aria-label="书架筛选">
            <button
              v-for="f in filters"
              :key="f.name"
              :aria-pressed="scope === f.name"
              @click="scope = f.name"
            >
              <component :is="f.icon" />
              {{ f.name }}
            </button>
          </nav>
          <label class="value-picker sort">
            <select v-model="order" aria-label="书架排序">
              <option>最近阅读</option>
              <option>导入时间</option>
              <option>书名</option>
            </select>
          </label>
        </div>
        <div v-if="visible.length" class="book-grid">
          <article v-for="book in visible" :key="book.id" class="book-card">
            <button class="book-main" @click="openReader(book)">
              <BookCover :cover="book.cover" :title="book.title" />
              <span>
                <strong>{{ book.title }}</strong>
                <small>{{ book.author }}</small>
                <small>{{ book.lastRead ? '已读 ' + book.progress + '%' : '未读' }}</small>
              </span>
            </button>
            <div class="card-actions">
              <button
                class="icon"
                :aria-label="book.favorite ? '取消收藏' : '收藏'"
                :aria-pressed="book.favorite"
                @click="toggleFavorite(book)"
              >
                <Heart />
              </button>
              <button class="icon" aria-label="移除书籍" @click="showDialog(book)"><Trash2 /></button>
            </div>
          </article>
        </div>
        <div v-else-if="loaded" class="empty">
          <LibraryBig />
          <p>{{ books.length ? '没有符合条件的书籍' : '书架还是空的' }}</p>
          <small v-if="!books.length">导入的图书会出现在这里。</small>
        </div>
      </section>
    </main>
    <dialog ref="modal" :class="{ 'settings-dialog': !deleting }" :aria-label="deleting ? '移除书籍' : syncSettings ? '进度同步' : '桌面设置'" @close="syncSettings = false">
      <template v-if="deleting">
        <h2>移除《{{ deleting.title }}》？</h2>
        <p>这会一并移除本机的阅读进度、书签和笔记。</p>
        <button class="danger" @click="erase">确认移除</button>
      </template>
      <template v-else>
        <header class="panel-heading">
          <h2>{{ syncSettings ? '进度同步' : '桌面设置' }}</h2>
          <button class="icon" aria-label="关闭" @click="modal?.close()"><X /></button>
        </header>
        <SyncSettings v-if="syncSettings" />
        <DisplaySettings v-else />
      </template>
      <button v-if="deleting" @click="modal?.close()">取消</button>
    </dialog>
  </div>
</template>
