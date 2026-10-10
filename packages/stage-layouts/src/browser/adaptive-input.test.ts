import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AdaptiveInput } from './adaptive-input'

interface TestViewport extends EventTarget {
  height: number
  offsetTop: number
  pageTop: number
}

function createPointerDown(): PointerEvent {
  return new PointerEvent('pointerdown', {
    button: 0,
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerType: 'touch',
  })
}

describe('adaptive input', () => {
  let animationFrames: Map<number, FrameRequestCallback>
  let keyboardViewportHeight: number
  let layoutHeight: number
  let nextAnimationFrameId: number
  let targetDocument: Document
  let targetWindow: Window
  let visualViewport: TestViewport

  function runAnimationFrame() {
    const callbacks = [...animationFrames.values()]
    animationFrames.clear()

    for (const callback of callbacks)
      callback(performance.now())
  }

  beforeEach(() => {
    animationFrames = new Map()
    layoutHeight = 714
    keyboardViewportHeight = layoutHeight - 310
    nextAnimationFrameId = 0
    visualViewport = Object.assign(new EventTarget(), {
      height: layoutHeight,
      offsetTop: 0,
      pageTop: 0,
    })

    const targetNavigator = Object.create(window.navigator)
    Object.defineProperty(targetNavigator, 'virtualKeyboard', {
      configurable: true,
      value: undefined,
    })

    targetDocument = Object.create(document)
    Object.defineProperties(targetDocument, {
      activeElement: {
        configurable: true,
        get: () => document.activeElement,
      },
      addEventListener: {
        configurable: true,
        value: document.addEventListener.bind(document),
      },
      documentElement: {
        configurable: true,
        value: {
          clientHeight: layoutHeight,
          clientWidth: 390,
        },
      },
    })

    targetWindow = Object.create(window)
    Object.defineProperties(targetWindow, {
      cancelAnimationFrame: {
        configurable: true,
        value: (id: number) => animationFrames.delete(id),
      },
      clearTimeout: {
        configurable: true,
        value: window.clearTimeout.bind(window),
      },
      document: {
        configurable: true,
        value: targetDocument,
      },
      matchMedia: {
        configurable: true,
        value: (query: string): MediaQueryList => ({
          addEventListener: () => undefined,
          addListener: () => undefined,
          dispatchEvent: () => true,
          matches: false,
          media: query,
          onchange: null,
          removeEventListener: () => undefined,
          removeListener: () => undefined,
        }),
      },
      navigator: {
        configurable: true,
        value: targetNavigator,
      },
      requestAnimationFrame: {
        configurable: true,
        value: (callback: FrameRequestCallback) => {
          const id = ++nextAnimationFrameId
          animationFrames.set(id, callback)
          return id
        },
      },
      setTimeout: {
        configurable: true,
        value: window.setTimeout.bind(window),
      },
      visualViewport: {
        configurable: true,
        value: visualViewport,
      },
    })
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('keeps the native touch activation while Safari closes the keyboard', () => {
    // ROOT CAUSE:
    // Canceling pointerdown during keyboard dismissal left only programmatic focus, which cannot stop native dismissal.
    // We fixed this by preserving native activation until the closing viewport becomes stable.
    const viewport = document.createElement('div')
    const area = document.createElement('div')
    const textarea = document.createElement('textarea')
    area.append(textarea)
    viewport.append(area)
    document.body.append(viewport)

    const adaptiveInput = new AdaptiveInput({ area, viewport, window: targetWindow })
    runAnimationFrame()

    textarea.focus()
    visualViewport.height = keyboardViewportHeight
    visualViewport.dispatchEvent(new Event('resize'))
    runAnimationFrame()
    textarea.blur()

    const pointerDown = createPointerDown()
    const nativeActivationContinues = textarea.dispatchEvent(pointerDown)

    expect(nativeActivationContinues).toBe(true)
    expect(pointerDown.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(document.body)
    expect(adaptiveInput.layout.keyboardVisible).toBe(false)
    expect(viewport.style.height).toBe(`${layoutHeight}px`)

    adaptiveInput.dispose()
  })

  it('keeps native touch activation after the closing viewport becomes stable', () => {
    const viewport = document.createElement('div')
    const area = document.createElement('div')
    const textarea = document.createElement('textarea')
    area.append(textarea)
    viewport.append(area)
    document.body.append(viewport)

    const adaptiveInput = new AdaptiveInput({ area, viewport, window: targetWindow })
    runAnimationFrame()

    textarea.focus()
    visualViewport.height = keyboardViewportHeight
    visualViewport.dispatchEvent(new Event('resize'))
    runAnimationFrame()
    textarea.blur()
    visualViewport.height = layoutHeight
    visualViewport.dispatchEvent(new Event('resize'))
    runAnimationFrame()

    const pointerDown = createPointerDown()
    const nativeActivationContinues = textarea.dispatchEvent(pointerDown)

    expect(nativeActivationContinues).toBe(true)
    expect(pointerDown.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(document.body)
    expect(adaptiveInput.layout.keyboardVisible).toBe(false)
    expect(viewport.style.height).toBe(`${layoutHeight}px`)

    adaptiveInput.dispose()
  })
})
