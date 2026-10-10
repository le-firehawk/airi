import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/window-message'
import { gameletIframeRequest } from '@proj-airi/plugin-sdk-tamagotchi/gamelet'
import { widgetsIframeInitEvent, widgetsIframePublishEvent } from '@proj-airi/plugin-sdk-tamagotchi/widgets'
import { afterEach, describe, expect, it } from 'vitest'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse())
    cleanup()
})

async function mountBridge() {
  const frame = document.createElement('iframe')
  frame.src = new URL('./eventa-runtime.fixture.html', import.meta.url).href
  const ready = new Promise<void>((resolve) => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const data = event.data
      if (event.source === frame.contentWindow
        && event.origin === window.location.origin
        && typeof data === 'object' && data !== null
        && 'type' in data && data.type === 'extension-ui-fixture-ready') {
        resolve()
      }
    }
    window.addEventListener('message', onMessage)
    cleanups.push(() => window.removeEventListener('message', onMessage))
  })
  document.body.append(frame)
  cleanups.push(() => frame.remove())
  await ready

  const host = createContext({
    channel: 'test:extension-ui',
    currentWindow: window,
    expectedSource: () => frame.contentWindow,
    targetWindow: () => frame.contentWindow,
  })
  cleanups.push(() => host.dispose())
  return host
}

describe('createContext', () => {
  it('relays typed events between parent and iframe windows', async () => {
    const host = await mountBridge()
    const published = new Promise<unknown>((resolve) => {
      host.context.on(widgetsIframePublishEvent, event => resolve(event.body))
    })

    host.context.emit(widgetsIframeInitEvent, {
      moduleId: 'module-chess',
      config: {},
      module: undefined,
      props: {},
    })

    await expect(published).resolves.toEqual({
      route: { namespace: 'plugin.chess', name: 'request' },
      payload: { moduleId: 'module-chess', requestId: 'req-1' },
    })
  })

  it('relays gamelet iframe invoke requests over the extension UI bridge', async () => {
    const host = await mountBridge()
    const invoke = defineInvoke(host.context, gameletIframeRequest)
    await expect(invoke({
      requestId: 'req-1',
      payload: { action: 'snapshot' },
    })).resolves.toEqual({ fen: 'fen-after-request' })
  })
})
