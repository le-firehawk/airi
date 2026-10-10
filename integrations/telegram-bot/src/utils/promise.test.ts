import { describe, expect, it, vi } from 'vitest'

import { cancellable } from './promise'

describe('cancellable', () => {
  it('returns a completed operation result', async () => {
    const task = cancellable(async () => 42)

    await expect(task.promise).resolves.toBe(42)
  })

  it('preserves an operation failure', async () => {
    const error = new Error('Request failed')
    const task = cancellable(async () => {
      throw error
    })

    await expect(task.promise).rejects.toBe(error)
  })

  it('handles a synchronous operation failure', async () => {
    const error = new Error('Request failed')
    const task = cancellable(() => {
      throw error
    })

    await expect(task.promise).rejects.toBe(error)
  })

  it('cancels before work starts', async () => {
    const operation = vi.fn(async () => 42)
    const task = cancellable(operation)
    task.cancel()

    await expect(task.promise).rejects.toThrow('CANCELLED')
    expect(operation).not.toHaveBeenCalled()
  })

  it('aborts active work and settles before the operation responds', async () => {
    const response = Promise.withResolvers<number>()
    const operation = vi.fn((_signal: AbortSignal) => response.promise)
    const task = cancellable(operation)
    await Promise.resolve()

    task.cancel()

    await expect(task.promise).rejects.toThrow('CANCELLED')
    expect(operation.mock.calls[0]?.[0].aborted).toBe(true)
    response.resolve(42)
    await expect(task.promise).rejects.toThrow('CANCELLED')
  })

  it('preserves the parent abort reason and handles a late failure', async () => {
    const controller = new AbortController()
    const response = Promise.withResolvers<number>()
    const operation = vi.fn((_signal: AbortSignal) => response.promise)
    const task = cancellable(operation, controller.signal)
    const error = new Error('Replaced by new input')
    await Promise.resolve()

    controller.abort(error)

    await expect(task.promise).rejects.toBe(error)
    expect(operation.mock.calls[0]?.[0].aborted).toBe(true)
    response.reject(new Error('Late network failure'))
    await expect(task.promise).rejects.toBe(error)
  })

  it('does not start work when the parent is already aborted', async () => {
    const controller = new AbortController()
    const error = new Error('Stopped')
    const operation = vi.fn(async () => 42)
    controller.abort(error)
    const task = cancellable(operation, controller.signal)

    await expect(task.promise).rejects.toBe(error)
    expect(operation).not.toHaveBeenCalled()
  })

  it('ignores cancellation after success', async () => {
    const operation = vi.fn(async (_signal: AbortSignal) => 42)
    const task = cancellable(operation)
    await expect(task.promise).resolves.toBe(42)

    task.cancel()

    expect(operation.mock.calls[0]?.[0].aborted).toBe(false)
    await expect(task.promise).resolves.toBe(42)
  })

  it('ignores cancellation after failure', async () => {
    const error = new Error('Request failed')
    const operation = vi.fn(async (_signal: AbortSignal) => {
      throw error
    })
    const task = cancellable(operation)
    await expect(task.promise).rejects.toBe(error)

    task.cancel()

    expect(operation.mock.calls[0]?.[0].aborted).toBe(false)
    await expect(task.promise).rejects.toBe(error)
  })
})
