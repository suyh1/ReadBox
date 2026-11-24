interface RenderSettings {
  hardwareRequested: boolean
  gpuCompositing: boolean
  forceSoftware: boolean
  restartRequired: boolean
}

interface Window {
  readbox?: {
    rendering(): Promise<RenderSettings>
    setHardwareAcceleration(enabled: boolean): Promise<RenderSettings>
  }
}
