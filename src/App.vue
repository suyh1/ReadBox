<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  BookOpen,
  LibraryBig,
  Heart,
  Clock3,
  Plus,
  Search,
  SlidersHorizontal,
  ArrowRight,
  Trash2,
  Settings2,
  X,
} from '@lucide/vue'
import BookCover from './components/BookCover.vue'
import DisplaySettings from './components/DisplaySettings.vue'
import Reader from './components/Reader.vue'
import { listBooks, removeBook, updateBook, type ShelfBook } from './reader/library'
import { importBook } from './reader/epub'
import sample from './assets/书页之间.epub?inline&url'

const desktop = window.readbox
const books = ref<ShelfBook[]>([])
const active = ref<ShelfBook>()
const reader = ref<InstanceType<typeof Reader>>()
const picker = ref<HTMLInputElement>()
const busy = ref(false)
const loaded = ref(false)
const notice = ref('')
const query = ref('')
const scope = ref('全部图书')
const order = ref('最近阅读')
const modal = ref<HTMLDialogElement>()
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
async function startSample() {
  const bytes = Uint8Array.from(atob(sample.split(',')[1]), (c) => c.charCodeAt(0))
  await ingest([new File([bytes], '书页之间.epub')], true)
}
function openReader(book: ShelfBook) {
  active.value = book
  notice.value = ''
  history.pushState({ book: book.id }, '')
}
function backToShelf() {
  history.back()
}
function handleBack(event: PopStateEvent) {
  if (event.state?.book && !active.value) {
    active.value = books.value.find((b) => b.id === event.state.book)
    return
  }
  if (active.value && reader.value?.dismissTool()) {
    history.pushState({ book: active.value.id }, '')
    return
  }
  active.value = undefined
  void refresh()
}
function showDialog(book?: ShelfBook) {
  deleting.value = book
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
onMounted(() => {
  void refresh()
  window.addEventListener('popstate', handleBack)
})
onUnmounted(() => window.removeEventListener('popstate', handleBack))
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
        <div class="brand">
          <BookOpen :size="25" />
          <strong>ReadBox</strong>
        </div>
        <button v-if="desktop" class="icon" aria-label="显示设置" @click="showDialog()"><Settings2 /></button>
      </div>
    </header>
    <main class="shelf">
      <div class="heading">
        <h1 id="ready">我的书房</h1>
        <button class="primary" :disabled="busy" @click="picker?.click()">
          <Plus />
          {{ busy ? '正在导入…' : '导入 EPUB' }}
        </button>
      </div>
      <input ref="picker" type="file" multiple accept=".epub,application/epub+zip" hidden @change="choose" />
      <p v-if="notice" role="status" class="notice">
        {{ notice }}
        <button class="icon" aria-label="关闭提示" @click="notice = ''"><X /></button>
      </p>
      <section v-if="loaded" class="feature">
        <div class="feature-copy">
          <span class="kicker">
            <BookOpen :size="15" />
            {{ featured ? (featured.lastRead ? '继续阅读' : '最近加入') : '内置试读' }}
          </span>
          <h2>{{ featured?.title || '书页之间' }}</h2>
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
      <section class="collection" aria-label="本地书架">
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
          <label class="sort">
            <SlidersHorizontal />
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
        <div v-else class="empty">
          <LibraryBig />
          <p>{{ !loaded ? '正在读取书架…' : books.length ? '没有符合条件的书籍' : '书架还是空的' }}</p>
          <small v-if="loaded && !books.length">选择或拖入 EPUB，开始收藏你的书。</small>
        </div>
      </section>
    </main>
    <dialog ref="modal">
      <template v-if="deleting">
        <h2>移除《{{ deleting.title }}》？</h2>
        <p>这会一并移除本机的阅读进度、书签和笔记。</p>
        <button class="danger" @click="erase">确认移除</button>
      </template>
      <DisplaySettings v-else />
      <button @click="modal?.close()">{{ deleting ? '取消' : '关闭' }}</button>
    </dialog>
  </div>
</template>
