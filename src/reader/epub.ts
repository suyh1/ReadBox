import ePub, { type Book, type NavItem } from 'epubjs'
import type Section from 'epubjs/types/section'
import { addBook, hasBook, type ShelfBook } from './library'

// The chapter inherits the host CSP as well. Only embedded book assets belong in it.
function prepareDocument(doc: Document) {
  doc
    .querySelectorAll('script, iframe, frame, object, embed, form, base, meta[http-equiv]')
    .forEach((el) => el.remove())
  for (const el of doc.querySelectorAll('*')) {
    for (const name of el.getAttributeNames()) {
      if (/^on/i.test(name)) el.removeAttribute(name)
    }
  }
  const policy = doc.createElementNS('http://www.w3.org/1999/xhtml', 'meta')
  policy.setAttribute('http-equiv', 'Content-Security-Policy')
  policy.setAttribute(
    'content',
    "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob: data:; font-src blob: data:; media-src blob: data:; form-action 'none'; base-uri 'none'",
  )
  doc.querySelector('head')?.prepend(policy)
}

export async function openBook(bytes: ArrayBuffer) {
  const book = ePub()
  // Some otherwise readable books reference a missing NCX. Fall back to the spine.
  const loadNavigation = book.loadNavigation.bind(book)
  book.loadNavigation = async (opf) => {
    try {
      return await loadNavigation(opf)
    } catch {
      return loadNavigation({} as XMLDocument)
    }
  }
  book.spine.hooks.content.register(prepareDocument)
  try {
    await book.open(bytes, 'binary')
    await Promise.all([book.opened, book.loaded.navigation])
    if (!book.spine.first()) throw new Error('没有可读章节')
    return book
  } catch (error) {
    closeBook(book)
    throw error
  }
}

export function closeBook(book: Book) {
  // epub.js 0.3.93 drops its URL tables on destroy without revoking CSS replacements.
  const resources = book.resources as (typeof book.resources & { replacementUrls?: string[] }) | undefined
  const archive = book.archive as (typeof book.archive & { urlCache?: Record<string, string> }) | undefined
  for (const url of [...(resources?.replacementUrls ?? []), ...Object.values(archive?.urlCache ?? {})]) {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
  }
  book.destroy()
}

export async function importBook(file: File) {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const id = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')
  if (await hasBook(id)) return { id, added: false }
  const book = await openBook(bytes)
  try {
    const first = book.spine.first()
    await first.load(book.load.bind(book))
    if (!first.document.querySelector('body, svg')) throw new Error('无法读取正文')
    const metadata = await book.loaded.metadata
    const coverPath = await book.loaded.cover
    const record: ShelfBook = {
      id,
      title: metadata.title?.trim() || file.name.replace(/\.epub$/i, ''),
      author: metadata.creator?.trim() || '未知作者',
      cover: coverPath ? await book.archive.getBlob(coverPath) : undefined,
      added: Date.now(),
      lastRead: 0,
      favorite: false,
      cfi: '',
      progress: 0,
      chapter: '',
      marks: [],
    }
    return { id, added: await addBook(record, new Blob([bytes], { type: 'application/epub+zip' })) }
  } finally {
    closeBook(book)
  }
}

export function spineOf(book: Book) {
  const sections: Section[] = []
  book.spine.each((section: Section) => sections.push(section))
  return sections
}

export function contentsOf(book: Book, sections: Section[]) {
  const entries: { label: string; href: string; depth: number; hasChildren: boolean }[] = []
  const navPath = book.packaging.navPath || book.packaging.ncxPath || ''
  function visit(items: NavItem[], depth: number) {
    for (const item of items) {
      let href = ''
      if (item.href) {
        const resolved = resolveLink(navPath, item.href)
        if (resolved && book.spine.get(resolved)) href = resolved
        else if (book.spine.get(item.href)) href = item.href
      }
      const index = entries.length
      const entry = { label: item.label.trim(), href, depth, hasChildren: false }
      entries.push(entry)
      visit(item.subitems || [], depth + 1)
      entry.hasChildren = entries.length > index + 1
      if (!href && !entry.hasChildren) entries.pop()
    }
  }
  visit(book.navigation.toc, 0)
  return entries.length
    ? entries
    : sections.map((section, i) => ({
        label: '第 ' + (i + 1) + ' 章',
        href: section.href,
        depth: 0,
        hasChildren: false,
      }))
}

export function resolveLink(from: string, href: string) {
  const root = 'https://epub.invalid/'
  try {
    const url = new URL(href, new URL(from, root))
    if (url.origin !== new URL(root).origin) return ''
    return url.pathname.slice(1) + url.hash
  } catch {
    return ''
  }
}

export interface Match {
  cfi: string
  excerpt: string
  chapter: string
}

export async function searchChapter(
  book: Book,
  section: Section,
  query: string,
  limit: number,
  label: string,
) {
  // Use an independent document so a background search never unloads a visible chapter.
  const doc = (await book.load(section.url)) as Document
  prepareDocument(doc)
  const body = doc.querySelector('body')
  const results: Match[] = []
  if (!body) return results
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  const nodes: { node: Node; start: number }[] = []
  let text = ''
  let group: Element | null = null
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.parentElement?.closest('style, script, [hidden]')) continue
    const block = node.parentElement?.closest('p,li,h1,h2,h3,h4,div,td') ?? body
    if (block !== group) text += '\n'
    group = block
    nodes.push({ node, start: text.length })
    text += node.textContent
  }
  const escaped = Array.from(query, (char) => '\\u{' + char.codePointAt(0)!.toString(16) + '}').join('')
  let i = 0
  for (const match of text.matchAll(new RegExp(escaped, 'giu'))) {
    const start = match.index!,
      end = start + match[0].length
    while (i + 1 < nodes.length && nodes[i + 1].start <= start) i++
    const range = doc.createRange()
    range.setStart(nodes[i].node, start - nodes[i].start)
    while (i + 1 < nodes.length && nodes[i + 1].start < end) i++
    range.setEnd(nodes[i].node, end - nodes[i].start)
    results.push({
      cfi: section.cfiFromRange(range),
      excerpt: text.slice(Math.max(0, start - 22), end + 36).trim(),
      chapter: label,
    })
    if (results.length >= limit) break
  }
  return results
}
