import type { BrowserWindowConstructorOptions, Rectangle } from 'electron'

/** Main-stage windows keep animation active without focus. The renderer still pauses explicitly when minimized. */
export function createMainWindowOptions(params: {
  bounds: Rectangle
  preloadPath: string
  icon: BrowserWindowConstructorOptions['icon']
  isMacOS: boolean
  transparentOptions: BrowserWindowConstructorOptions
}): BrowserWindowConstructorOptions {
  return {
    ...params.transparentOptions,
    title: 'AIRI',
    ...params.bounds,
    resizable: true,
    show: false,
    icon: params.icon,
    webPreferences: {
      preload: params.preloadPath,
      sandbox: false,
      // The companion stays active without focus. Chromium throttling conflicts with that lifecycle policy.
      backgroundThrottling: false,
    },
    // macOS panels remain above full-screen applications without changing focus behavior.
    type: params.isMacOS ? 'panel' : undefined,
  }
}
