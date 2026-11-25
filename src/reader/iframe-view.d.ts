// epub.js publishes types for the view interface but omits its iframe implementation.
declare module 'epubjs/src/managers/views/iframe' {
  import type { Contents } from 'epubjs'
  export default class IframeView {
    iframe: HTMLIFrameElement
    element: HTMLElement
    onLoad(event: Event, loaded: { resolve(contents: Contents): void }): void
    load(contents: string): Promise<Contents>
  }
}
