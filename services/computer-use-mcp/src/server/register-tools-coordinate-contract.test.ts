import { describe, expect, it, vi } from 'vitest'

import { RunStateManager } from '../state'
import { createTestConfig } from '../test-fixtures'
import { registerComputerUseTools } from './register-tools'
import { createTestRuntime } from './test-fixtures'
import { createTestServer } from './test-server'

function createRegistrationRuntime() {
  return createTestRuntime({
    config: createTestConfig(),
    stateManager: new RunStateManager(),
    session: {},
    executor: {},
    terminalRunner: {},
    browserDomBridge: {},
    cdpBridgeManager: {},
    chromeSessionManager: {},
    desktopSessionController: {},
    taskMemory: {},
  })
}

describe('registerComputerUseTools coordinate contract', () => {
  it('documents mutating desktop target coordinates as global logical screen coordinates', () => {
    const testServer = createTestServer()
    const { server } = testServer

    registerComputerUseTools({
      server,
      runtime: createRegistrationRuntime(),
      executeAction: vi.fn(),
      enableTestTools: false,
    })

    const { schemas } = testServer

    expect(schemas.get('desktop_click')?.x.description).toBe('Global logical screen X coordinate, not Retina backing pixels')
    expect(schemas.get('desktop_click')?.y.description).toBe('Global logical screen Y coordinate, not Retina backing pixels')
    expect(schemas.get('desktop_type_text')?.x.description).toBe('Optional global logical screen X coordinate to click before typing')
    expect(schemas.get('desktop_type_text')?.y.description).toBe('Optional global logical screen Y coordinate to click before typing')
    expect(schemas.get('desktop_scroll')?.x.description).toBe('Optional global logical screen X coordinate to move to before scrolling')
    expect(schemas.get('desktop_scroll')?.y.description).toBe('Optional global logical screen Y coordinate to move to before scrolling')
  })
})
