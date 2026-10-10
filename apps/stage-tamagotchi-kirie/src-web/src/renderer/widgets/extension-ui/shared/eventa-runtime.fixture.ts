import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/window-message'
import { gameletIframeRequest } from '@proj-airi/plugin-sdk-tamagotchi/gamelet'
import { widgetsIframeInitEvent, widgetsIframePublishEvent } from '@proj-airi/plugin-sdk-tamagotchi/widgets'

const bridge = createContext({
  channel: 'test:extension-ui',
  currentWindow: window,
  expectedSource: () => window.parent,
  targetWindow: () => window.parent,
})

bridge.context.on(widgetsIframeInitEvent, (event) => {
  bridge.context.emit(widgetsIframePublishEvent, {
    route: { namespace: 'plugin.chess', name: 'request' },
    payload: { moduleId: event.body?.moduleId, requestId: 'req-1' },
  })
})

defineInvokeHandler(bridge.context, gameletIframeRequest, ({ payload }) => ({
  fen: payload.action === 'snapshot' ? 'fen-after-request' : 'unknown',
}))

window.addEventListener('pagehide', () => bridge.dispose(), { once: true })
window.parent.postMessage({ type: 'extension-ui-fixture-ready' }, window.location.origin)
