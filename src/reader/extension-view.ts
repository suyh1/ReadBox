import IframeView from 'epubjs/src/managers/views/iframe'
import type { Contents } from 'epubjs'

// Give GeckoView a packaged document at the same extension origin as its parent.
// epub.js still owns sandbox flags, sizing, pagination, selection and destruction.
export class ExtensionChapterView extends IframeView {
  override load(chapter: string): Promise<Contents> {
    const frame = this.iframe
    let timeout: number
    return new Promise<Contents>((resolve, reject) => {
      timeout = window.setTimeout(() => reject(new Error('内置章节页面加载超时')), 15000)
      frame.onerror = () => reject(new Error('无法加载内置章节页面'))
      frame.onload = (event) => {
        try {
          const target = frame.contentDocument
          if (!target) throw new Error('无法访问章节页面')
          const source = new DOMParser().parseFromString(chapter, 'text/html')
          target.replaceChild(target.importNode(source.documentElement, true), target.documentElement)
          this.onLoad(event, { resolve })
        } catch (error) {
          reject(error)
        }
      }
      frame.src = new URL('chapter.html', window.location.href).href
      this.element.appendChild(frame)
    }).finally(() => {
      window.clearTimeout(timeout)
      frame.onload = null
      frame.onerror = null
    })
  }
}
