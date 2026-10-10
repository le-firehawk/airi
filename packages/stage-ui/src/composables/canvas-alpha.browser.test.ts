import { afterEach, describe, expect, it } from 'vitest'

import { isCanvasRegionTransparent } from './canvas-alpha'

interface GlOptions {
  hotPixel?: { x: number, y: number, alpha?: number }
  width?: number
  height?: number
}

const contexts: WebGLRenderingContext[] = []

afterEach(() => {
  for (const context of contexts.splice(0))
    context.getExtension('WEBGL_lose_context')?.loseContext()
})

function createGl(options: GlOptions = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = options.width ?? 100
  canvas.height = options.height ?? 100
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true })
  if (!gl)
    throw new Error('WebGL is required for canvas transparency tests')
  contexts.push(gl)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  if (options.hotPixel) {
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(options.hotPixel.x, options.hotPixel.y, 1, 1)
    gl.clearColor(0, 0, 0, (options.hotPixel.alpha ?? 255) / 255)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.SCISSOR_TEST)
  }
  return gl
}

describe('isCanvasRegionTransparent', () => {
  it('returns true when cursor is outside canvas bounds', () => {
    const gl = createGl()

    const result = isCanvasRegionTransparent({
      gl,
      clientX: 150,
      clientY: 150,
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      radius: 10,
      threshold: 10,
    })

    expect(result).toBe(true)
  })

  it('returns false when an opaque pixel is inside the circular region', () => {
    const gl = createGl({ hotPixel: { x: 50, y: 49, alpha: 255 } })

    const result = isCanvasRegionTransparent({
      gl,
      clientX: 50,
      clientY: 50,
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      radius: 10,
      threshold: 10,
    })

    expect(result).toBe(false)
  })

  it('ignores opaque pixels outside the circular region but inside read bounds', () => {
    const gl = createGl({ hotPixel: { x: 80, y: 80, alpha: 255 } })

    const result = isCanvasRegionTransparent({
      gl,
      clientX: 50,
      clientY: 50,
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      radius: 5,
      threshold: 10,
    })

    expect(result).toBe(true)
  })

  it('uses only the exact cursor pixel when the radius is zero', () => {
    const gl = createGl({ hotPixel: { x: 50, y: 49, alpha: 255 } })

    const result = isCanvasRegionTransparent({
      gl,
      clientX: 50,
      clientY: 50,
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      radius: 0,
      threshold: 10,
    })

    expect(result).toBe(false)
  })
})
