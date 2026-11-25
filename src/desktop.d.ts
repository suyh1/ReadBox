interface RenderSettings {
  hardwareRequested: boolean
  gpuCompositing: boolean
  forceSoftware: boolean
  restartRequired: boolean
}

interface Window {
  readbox?: {
    dataDirectory(): Promise<string>
    migrateData(): Promise<void>
    onWindowActivity(callback: (active: boolean) => void): () => void
    shortcut(): Promise<{ key: string; active: boolean }>
    setShortcut(key: string): Promise<{ key: string; active: boolean }>
    davSettings(): Promise<import('../desktop/webdav.mjs').DavConfig | null>
    saveDavSettings(config: import('../desktop/webdav.mjs').DavConfig | null): Promise<void>
    requestProgress: typeof import('../desktop/webdav.mjs').requestProgress
    probeDirectory: typeof import('../desktop/webdav.mjs').probeDirectory
    rendering(): Promise<RenderSettings>
    setHardwareAcceleration(enabled: boolean): Promise<RenderSettings>
  }
}
