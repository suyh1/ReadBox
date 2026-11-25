import IframeView from 'epubjs/src/managers/views/iframe'
import type { Contents } from 'epubjs'

// Populate the initial, same-origin blank document directly. Navigating a child
// frame can create a separate GeckoView history/accessibility document on Android.
export class ExtensionChapterView extends IframeView {
  override async load(chapter: string): Promise<Contents> {
    const frame = this.iframe
    this.element.appendChild(frame)
    const target = frame.contentDocument
    if (!target) throw new Error('无法访问章节页面')
    const source = new DOMParser().parseFromString(chapter, 'text/html')
    target.replaceChild(target.importNode(source.documentElement, true), target.documentElement)
    return new Promise<Contents>((resolve) => this.onLoad(new Event('load'), { resolve }))
  }
}
