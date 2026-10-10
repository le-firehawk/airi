import { PerspectiveCamera, Raycaster, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { useVRMEyeFocusFor } from './eye-tracking'

describe('useVRMEyeFocusFor', () => {
  /**
   * @example
   * expect(focus.value).toBe(defaultLookAt)
   */
  it('returns the default target when mouse mode has no tracking source', () => {
    const defaultLookAt = new Vector3(1, 2, 3)

    const focus = useVRMEyeFocusFor({
      cameraPosition: () => ({ x: 0, y: 0, z: -1 }),
      context: () => ({
        raycaster: new Raycaster(),
        camera: new PerspectiveCamera(40, 1, 0.1),
        defaultLookAt,
      }),
      screenBoundingBox: () => ({ top: 0, left: 0, width: 100, height: 100 }),
      source: () => null,
      trackingMode: () => 'mouse',
    })

    expect(focus.value).toBe(defaultLookAt)
  })

  /**
   * @example
   * expect(raycaster.setFromCamera).toHaveBeenCalled()
   */
  it('uses the plain tracking source when mouse tracking is active', () => {
    const raycaster = new Raycaster(new Vector3(0, 0, 0), new Vector3(0, 0, -1))
    vi.spyOn(raycaster, 'setFromCamera')
    const focus = useVRMEyeFocusFor({
      cameraPosition: () => ({ x: 0, y: 0, z: -1 }),
      context: () => ({
        raycaster,
        camera: new PerspectiveCamera(40, 1, 0.1),
        defaultLookAt: new Vector3(1, 2, 3),
      }),
      screenBoundingBox: () => ({ top: 0, left: 0, width: 100, height: 100 }),
      source: () => ({ x: 50, y: 50 }),
      trackingMode: () => 'mouse',
    })

    expect(focus.value).toEqual(new Vector3(0, 0, -0.8))
    expect(raycaster.setFromCamera).toHaveBeenCalled()
  })
})
