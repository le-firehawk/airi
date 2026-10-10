import { getEventListeners } from 'node:events'

import { AbortSignal as TelegramAbortSignal } from 'abort-controller'
import { describe, expect, it, vi } from 'vitest'

import { withTelegramAbortSignal } from './telegram'

describe('withTelegramAbortSignal', () => {
  it('passes a Grammy-compatible signal and preserves a successful result', async () => {
    const controller = new AbortController()
    const operation = vi.fn(async (_signal: TelegramAbortSignal) => 'Sent')

    await expect(withTelegramAbortSignal(controller.signal, operation)).resolves.toBe('Sent')

    expect(operation.mock.calls[0]?.[0]).toBeInstanceOf(TelegramAbortSignal)
    expect(operation.mock.calls[0]?.[0].aborted).toBe(false)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)

    controller.abort()

    expect(operation.mock.calls[0]?.[0].aborted).toBe(false)
  })

  it('forwards cancellation that occurs before the request starts', async () => {
    const controller = new AbortController()
    controller.abort()
    const operation = vi.fn(async (signal: TelegramAbortSignal) => signal.aborted)

    await expect(withTelegramAbortSignal(controller.signal, operation)).resolves.toBe(true)

    expect(operation.mock.calls[0]?.[0].aborted).toBe(true)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('removes the native listener on abort before a late delivery result', async () => {
    const controller = new AbortController()
    const response = Promise.withResolvers<string>()
    const operation = vi.fn((_signal: TelegramAbortSignal) => response.promise)
    const result = withTelegramAbortSignal(controller.signal, operation)

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
    controller.abort()

    expect(operation.mock.calls[0]?.[0].aborted).toBe(true)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)

    response.resolve('Accepted before cancellation')

    await expect(result).resolves.toBe('Accepted before cancellation')
  })

  it('removes the native listener after a request failure', async () => {
    const controller = new AbortController()
    const error = new Error('Request failed')
    const operation = vi.fn(async (_signal: TelegramAbortSignal) => {
      throw error
    })

    await expect(withTelegramAbortSignal(controller.signal, operation)).rejects.toBe(error)

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    controller.abort()
    expect(operation.mock.calls[0]?.[0].aborted).toBe(false)
  })

  it('removes the native listener after a synchronous request failure', async () => {
    const controller = new AbortController()
    const error = new Error('Request failed')
    const operation = vi.fn((_signal: TelegramAbortSignal) => {
      throw error
    })

    await expect(withTelegramAbortSignal(controller.signal, operation)).rejects.toBe(error)

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    controller.abort()
    expect(operation.mock.calls[0]?.[0].aborted).toBe(false)
  })

  it('preserves a request failure after cancellation', async () => {
    const controller = new AbortController()
    const response = Promise.withResolvers<string>()
    const operation = vi.fn((_signal: TelegramAbortSignal) => response.promise)
    const result = withTelegramAbortSignal(controller.signal, operation)
    const error = new Error('Request aborted')
    controller.abort()
    response.reject(error)

    await expect(result).rejects.toBe(error)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('keeps concurrent requests isolated during cleanup', async () => {
    const controller = new AbortController()
    const firstResponse = Promise.withResolvers<string>()
    const secondResponse = Promise.withResolvers<string>()
    const firstOperation = vi.fn((_signal: TelegramAbortSignal) => firstResponse.promise)
    const secondOperation = vi.fn((_signal: TelegramAbortSignal) => secondResponse.promise)
    const firstResult = withTelegramAbortSignal(controller.signal, firstOperation)
    const secondResult = withTelegramAbortSignal(controller.signal, secondOperation)
    firstResponse.resolve('First accepted')
    await firstResult

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
    controller.abort()
    expect(firstOperation.mock.calls[0]?.[0].aborted).toBe(false)
    expect(secondOperation.mock.calls[0]?.[0].aborted).toBe(true)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)

    secondResponse.resolve('Second accepted')
    await expect(secondResult).resolves.toBe('Second accepted')
  })
})
