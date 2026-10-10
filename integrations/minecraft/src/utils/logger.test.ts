import { Format, LogLevel } from '@guiiai/logg'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLogger } from './logger'

const debugLog = vi.hoisted(() => vi.fn())
vi.mock('../debug', () => ({ DebugService: { getInstance: () => ({ log: debugLog }) } }))

beforeEach(() => debugLog.mockClear())

describe('debug logger forwarding', () => {
  it('keeps the complete logger interface', () => {
    const logger = useLogger()
    expect(typeof logger.withFormat).toBe('function')
    expect(typeof logger.withLogLevel).toBe('function')
    expect(typeof logger.withField).toBe('function')
  })

  it('keeps caller context and merged fields across derived loggers', () => {
    const logger = useLogger().withFields({ task: 'follow' }).withFields({ attempt: 2 })
    logger.warn('waiting')
    expect(debugLog).toHaveBeenCalledWith('WARN', expect.stringContaining('waiting'), expect.objectContaining({ task: 'follow', attempt: 2 }))
  })

  it('keeps debug forwarding after logger configuration chains', () => {
    useLogger().withFormat(Format.JSON).withLogLevel(LogLevel.Warning).child({ task: 'follow' }).warn('waiting')
    expect(debugLog).toHaveBeenCalledTimes(1)
    expect(debugLog).toHaveBeenCalledWith('WARN', expect.stringContaining('waiting'), expect.objectContaining({ task: 'follow' }))
  })

  it('forwards an error once', () => {
    const error = new Error('offline')
    useLogger().withFields({ task: 'follow' }).errorWithError('failed', error)
    expect(debugLog).toHaveBeenCalledTimes(1)
    expect(debugLog).toHaveBeenCalledWith('ERROR', expect.stringContaining('failed'), { task: 'follow', error })
  })
})
