import type { ComputerUseServerRuntime } from './runtime'

import { vi } from 'vitest'

import { BrowserDomExtensionBridge } from '../browser-dom/extension-bridge'
import { createChromeSessionManager } from '../chrome-session-manager'
import { createDesktopSessionController } from '../desktop-session'
import { createDryRunExecutor } from '../executors/dry-run'
import { ComputerUseSession } from '../session'
import { RunStateManager } from '../state'
import { TaskMemoryManager } from '../task-memory/manager'
import { createLocalShellRunner } from '../terminal/runner'
import { createTestConfig } from '../test-fixtures'
import { createCdpBridgeManager } from './cdp-manager'

type RuntimeOverrides = {
  [Key in Exclude<keyof ComputerUseServerRuntime, 'stateManager'>]?: Partial<ComputerUseServerRuntime[Key]>
} & { stateManager?: RunStateManager }

/**
 * Builds a complete runtime without starting IO. External operations are mocks.
 * State remains real, while each test supplies the method results it needs.
 */
export function createTestRuntime(overrides: RuntimeOverrides = {}): ComputerUseServerRuntime {
  const config = createTestConfig(overrides.config)
  const stateManager = overrides.stateManager ?? new RunStateManager()

  return {
    config,
    stateManager,
    session: Object.assign(vi.mockObject(new ComputerUseSession(config)), overrides.session),
    executor: Object.assign(vi.mockObject(createDryRunExecutor(config)), overrides.executor),
    terminalRunner: Object.assign(vi.mockObject(createLocalShellRunner(config)), overrides.terminalRunner),
    browserDomBridge: Object.assign(vi.mockObject(new BrowserDomExtensionBridge(config.browserDomBridge)), overrides.browserDomBridge),
    cdpBridgeManager: Object.assign(vi.mockObject(createCdpBridgeManager(config)), overrides.cdpBridgeManager),
    taskMemory: Object.assign(vi.mockObject(new TaskMemoryManager()), overrides.taskMemory),
    chromeSessionManager: Object.assign(vi.mockObject(createChromeSessionManager(config)), overrides.chromeSessionManager),
    desktopSessionController: Object.assign(vi.mockObject(createDesktopSessionController(stateManager)), overrides.desktopSessionController),
  }
}
