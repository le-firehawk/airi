import type { SandboxWorkerRequest } from './js-planner-sandbox-protocol'

import childProcess from 'node:child_process'
import process from 'node:process'

import { syncBuiltinESMExports } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { executeSandboxWorker } from './js-planner-sandbox-runner'

const request: SandboxWorkerRequest = {
  bootstrapScript: '',
  bridgeAvailability: {
    botCall: false,
    forgetConversation: false,
    getNoActionBudget: false,
    notifyAiri: false,
    patternFind: false,
    patternGet: false,
    patternIds: false,
    patternList: false,
    queryBlockAt: false,
    queryMap: false,
    setNoActionBudget: false,
    updateAiriContext: false,
  },
  memoryLimitMb: 16,
  runtime: {
    actionQueue: null,
    currentInput: null,
    errorBurstGuard: null,
    event: { type: 'system_alert', payload: {}, source: { type: 'system', id: 'test' }, timestamp: 0 },
    historySeed: { conversationHistory: [], currentTurn: 0, llmLogEntries: [] },
    lastAction: null,
    llmInput: null,
    llmLogEntries: [],
    mem: {},
    noActionBudget: null,
    prevRun: null,
    querySeed: null,
    snapshot: {},
  },
  script: 'return { value: 42, process: typeof process, require: typeof require }',
  timeoutMs: 1000,
  toolNames: [],
}

afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  vi.unstubAllEnvs()
})

describe('sandbox worker launch', () => {
  it('loads the real native runtime without inheriting parent environment variables', async () => {
    vi.stubEnv('AIRI_SANDBOX_TEST_SECRET', 'parent-only-test-value')
    vi.stubEnv('LIBC', 'untrusted-parent-value')
    const fork = vi.spyOn(childProcess, 'fork')
    syncBuiltinESMExports()

    const result = await executeSandboxWorker(request, {
      bridgeTimeoutMs: 1000,
      maxBridgeCalls: 1,
      onBridgeRequest: async () => undefined,
    })

    expect(result.returnRaw).toEqual({ value: 42, process: 'undefined', require: 'undefined' })
    expect(fork).toHaveBeenCalledOnce()
    const options = fork.mock.calls[0]?.[2]
    const environment = options?.env
    if (process.platform === 'linux') {
      expect(environment).toEqual({ LIBC: expect.stringMatching(/^(?:glibc|musl)$/) })
    }
    else {
      expect(environment).toEqual({})
    }
    expect(environment).not.toHaveProperty('AIRI_SANDBOX_TEST_SECRET')
    expect(environment?.LIBC).not.toBe('untrusted-parent-value')
    expect(options?.execArgv).toContain('--permission')
    expect(options?.execArgv).toContain('--disable-proto=throw')
    expect(options?.execArgv).toContain('--frozen-intrinsics')
    expect(options?.execArgv).toContain('--no-node-snapshot')
    expect(options?.execArgv).not.toContain('--experimental-transform-types')
    expect(options?.execArgv?.filter(argument => argument.startsWith('--allow-fs-read='))).toHaveLength(2)
  })
})
