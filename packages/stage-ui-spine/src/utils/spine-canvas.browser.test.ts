import type { SpineCanvasBackend } from './spine-canvas'

import { OrthoCamera } from '@esotericsoftware/spine-webgl'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SpineCanvas } from './spine-canvas'

const owned: SpineCanvas[] = []

afterEach(() => {
  for (const canvas of owned.splice(0))
    canvas.dispose()
})

async function nextFrame() {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
}

function createBackend() {
  return {
    assetManager: {
      source: {},
      loadBinary: vi.fn(),
      loadJson: vi.fn(),
      loadTextureAtlas: vi.fn(),
      isLoadingComplete: vi.fn(() => true),
      hasErrors: vi.fn(() => false),
      getErrors: vi.fn(() => ({})),
    },
    camera: new OrthoCamera(100, 100),
    createModel: vi.fn<SpineCanvasBackend['createModel']>(),
    createTexture: vi.fn<SpineCanvasBackend['createTexture']>(),
    resize: vi.fn(),
    begin: vi.fn(),
    end: vi.fn(),
    advanceTime: vi.fn(() => 0.016),
    dispose: vi.fn(),
  } satisfies SpineCanvasBackend
}

describe('spine canvas lifecycle', () => {
  it('stops a loading canvas before callbacks can start', async () => {
    const backend = createBackend()
    backend.assetManager.isLoadingComplete.mockReturnValue(false)
    const initialize = vi.fn()
    const render = vi.fn()
    const canvas = new SpineCanvas(backend, { initialize, render }, document.createElement('canvas'))
    owned.push(canvas)
    canvas.dispose()
    backend.assetManager.isLoadingComplete.mockReturnValue(true)
    await nextFrame()
    expect(initialize).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
    expect(backend.dispose).toHaveBeenCalledOnce()
  })

  it('does not schedule another frame when rendering disposes its canvas', async () => {
    const backend = createBackend()
    const render = vi.fn((canvas: SpineCanvas) => canvas.dispose())
    const canvas = new SpineCanvas(backend, { render }, document.createElement('canvas'))
    owned.push(canvas)
    await nextFrame()
    await nextFrame()
    expect(render).toHaveBeenCalledOnce()
    expect(backend.dispose).toHaveBeenCalledOnce()
  })

  it('stops the old loop when a replacement uses the same element', async () => {
    const element = document.createElement('canvas')
    const oldRender = vi.fn()
    const oldCanvas = new SpineCanvas(createBackend(), { render: oldRender }, element)
    owned.push(oldCanvas)
    await nextFrame()
    oldCanvas.dispose()
    const oldFrames = oldRender.mock.calls.length
    const nextRender = vi.fn()
    const nextCanvas = new SpineCanvas(createBackend(), { render: nextRender }, element)
    owned.push(nextCanvas)
    await nextFrame()
    expect(oldRender).toHaveBeenCalledTimes(oldFrames)
    expect(nextRender).toHaveBeenCalled()
  })

  it('disposes on context loss and ignores later restore events', async () => {
    const element = document.createElement('canvas')
    const backend = createBackend()
    const render = vi.fn()
    const error = vi.fn()
    const canvas = new SpineCanvas(backend, { render, error }, element)
    owned.push(canvas)
    await nextFrame()
    const frames = render.mock.calls.length
    element.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    element.dispatchEvent(new Event('webglcontextrestored'))
    await nextFrame()
    expect(error).toHaveBeenCalledWith(canvas, { context: 'WebGL context lost.' })
    expect(backend.dispose).toHaveBeenCalledOnce()
    expect(render).toHaveBeenCalledTimes(frames)
  })

  it('does not start a loop after synchronous load disposal', async () => {
    const backend = createBackend()
    const render = vi.fn()
    const canvas = new SpineCanvas(backend, { loadAssets: canvas => canvas.dispose(), render }, document.createElement('canvas'))
    owned.push(canvas)
    await nextFrame()
    expect(render).not.toHaveBeenCalled()
    expect(backend.dispose).toHaveBeenCalledOnce()
  })

  it('releases resources if loading throws before construction completes', async () => {
    const backend = createBackend()
    const failure = new Error('Failed to load assets.')
    const render = vi.fn()
    expect(() => new SpineCanvas(backend, {
      loadAssets: () => { throw failure },
      render,
    }, document.createElement('canvas'))).toThrow(failure)
    await nextFrame()
    expect(render).not.toHaveBeenCalled()
    expect(backend.dispose).toHaveBeenCalledOnce()
  })

  it('retains both errors if failed construction also fails cleanup', () => {
    const backend = createBackend()
    const failure = new Error('Failed to load assets.')
    const cleanupFailure = new Error('Failed to dispose assets.')
    backend.dispose.mockImplementation(() => {
      throw cleanupFailure
    })
    try {
      const canvas = new SpineCanvas(backend, {
        loadAssets: () => {
          throw failure
        },
      }, document.createElement('canvas'))
      owned.push(canvas)
      expect.fail('Expected construction to fail.')
    }
    catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      if (!(error instanceof AggregateError))
        throw error
      expect(error.errors).toEqual([failure, cleanupFailure])
    }
  })

  it('settles disposal even when resource cleanup throws', async () => {
    const backend = createBackend()
    const failure = new Error('Failed to dispose assets.')
    backend.dispose.mockImplementation(() => {
      throw failure
    })
    const dispose = vi.fn()
    const render = vi.fn()
    const canvas = new SpineCanvas(backend, { render, dispose }, document.createElement('canvas'))
    owned.push(canvas)
    expect(() => canvas.dispose()).toThrow(failure)
    await nextFrame()
    expect(render).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
    expect(backend.dispose).toHaveBeenCalledOnce()
  })

  it('releases assets and settles disposal when loading fails', async () => {
    const backend = createBackend()
    backend.assetManager.hasErrors.mockReturnValue(true)
    const error = vi.fn()
    const dispose = vi.fn()
    const canvas = new SpineCanvas(backend, { error, dispose }, document.createElement('canvas'))
    owned.push(canvas)
    await nextFrame()
    expect(error).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
    expect(backend.dispose).toHaveBeenCalledOnce()
  })
})
