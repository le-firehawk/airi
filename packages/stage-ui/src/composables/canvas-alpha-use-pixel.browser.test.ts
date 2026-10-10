import { describe, expect, it } from 'vitest'
import { effectScope, ref } from 'vue'

import { useCanvasPixelAtPoint } from './canvas-alpha'

describe('useCanvasPixelAtPoint', () => {
  it('flips the Y coordinate before reading the WebGL pixel', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 100
    canvas.style.cssText = 'position:fixed;left:10px;top:20px;width:100px;height:100px'
    document.body.append(canvas)
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })
    if (!gl)
      throw new Error('WebGL2 is required for canvas pixel tests')

    const scope = effectScope()
    try {
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(100, 89, 1, 1)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const state = scope.run(() => useCanvasPixelAtPoint(ref(canvas), ref(60), ref(30)))!
      await expect.poll(() => Array.from(state.pixel.value)).toEqual([0, 0, 0, 255])
    }
    finally {
      scope.stop()
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
    }
  })
})
