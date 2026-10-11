import { describe, expect, it } from 'vitest'

import { createMainWindowOptions } from './window-options'

describe('main companion window options', () => {
  it.each([false, true])('keeps background rendering active on macOS=%s', (isMacOS) => {
    const options = createMainWindowOptions({
      bounds: { x: -200, y: 30, width: 450, height: 600 },
      preloadPath: '/app/preload/index.mjs',
      icon: '/app/icon.png',
      isMacOS,
      transparentOptions: { frame: false, transparent: true, hasShadow: false },
    })
    expect(options.webPreferences?.backgroundThrottling).toBe(false)
    expect(options.webPreferences?.preload).toBe('/app/preload/index.mjs')
    expect(options.webPreferences?.sandbox).toBe(false)
    expect(options.type).toBe(isMacOS ? 'panel' : undefined)
    expect(options.show).toBe(false)
    expect(options.resizable).toBe(true)
    expect(options.transparent).toBe(true)
    expect(options.frame).toBe(false)
    expect(options.hasShadow).toBe(false)
    expect(options.x).toBe(-200)
    expect(options.y).toBe(30)
    expect(options.width).toBe(450)
    expect(options.height).toBe(600)
  })
})
