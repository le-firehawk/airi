import { VRMLookAt, VRMLookAtBoneApplier, VRMLookAtRangeMap } from '@pixiv/three-vrm-core'
import { Object3D, PerspectiveCamera, Raycaster, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { createTestVrm } from '../test-utils/vrm'
import { useVRMEyeFocusFor, VRMEyeFocus } from './eye-tracking'

function createFocus() {
  const vrm = createTestVrm()
  const range = new VRMLookAtRangeMap(90, 90)
  const lookAt = new VRMLookAt(vrm.humanoid, new VRMLookAtBoneApplier(vrm.humanoid, range, range, range, range))
  lookAt.faceFront.set(0, 0, -1)
  const camera = new PerspectiveCamera(40, 2, 0.01)
  camera.position.set(0, 0.8, -2)
  camera.lookAt(0, 0.8, 0)
  camera.updateMatrixWorld(true)
  const source = ref<{ x: number, y: number } | null>({ x: 300, y: 150 })
  const defaultLookAt = new Vector3(0, 1.5, -100)
  const mode = ref<'mouse' | 'camera' | 'none'>('mouse')
  const screen = ref({ left: 100, top: 50, width: 400, height: 200 })
  const focus = useVRMEyeFocusFor({
    cameraPosition: () => camera.position,
    context: () => ({ camera, raycaster: new Raycaster(), defaultLookAt, lookAtOrigin: lookAt.getLookAtWorldPosition(new Vector3()) }),
    screenBoundingBox: screen,
    source,
    trackingMode: mode,
  })
  return { vrm, lookAt, camera, source, defaultLookAt, mode, screen, focus }
}

describe('useVRMEyeFocusFor', () => {
  it('returns the default target when mouse mode has no tracking source', () => {
    const { source, defaultLookAt, focus } = createFocus()
    source.value = null
    expect(focus()).toBe(defaultLookAt)
  })

  // ROOT CAUSE:
  // Targets near the camera stayed below the eyes and compressed cursor movement into a small angle.
  // An eye-centered plane uses the full viewport range, independent of the near clipping distance.
  it('keeps mouse gaze neutral at the viewport center with a camera below the eyes', () => {
    const { lookAt, focus } = createFocus()
    lookAt.lookAt(focus())
    expect(lookAt.yaw).toBeCloseTo(0)
    expect(lookAt.pitch).toBeCloseTo(0)
  })

  it('moves actual VRM pitch both above and below neutral', () => {
    const { source, lookAt, focus } = createFocus()
    source.value = { x: 300, y: 50 }
    lookAt.lookAt(focus())
    expect(lookAt.pitch).toBeLessThan(-15)
    source.value = { x: 300, y: 250 }
    lookAt.lookAt(focus())
    expect(lookAt.pitch).toBeGreaterThan(15)
    expect(lookAt.yaw).toBeCloseTo(0)
  })

  it('moves actual VRM yaw in opposite directions at the viewport sides', () => {
    const { source, lookAt, focus } = createFocus()
    source.value = { x: 100, y: 150 }
    lookAt.lookAt(focus())
    const leftYaw = lookAt.yaw
    expect(leftYaw).toBeLessThan(-25)
    expect(lookAt.pitch).toBeCloseTo(0)
    source.value = { x: 500, y: 150 }
    lookAt.lookAt(focus())
    expect(lookAt.yaw).toBeGreaterThan(25)
    expect(lookAt.yaw).toBeCloseTo(-leftYaw)
    expect(lookAt.pitch).toBeCloseTo(0)
  })
})

describe('gaze projection boundaries', () => {
  it('preserves camera and disabled tracking targets', () => {
    const { mode, camera, defaultLookAt, focus } = createFocus()
    mode.value = 'camera'
    expect(focus().toArray()).toEqual(camera.position.toArray())
    mode.value = 'none'
    expect(focus()).toBe(defaultLookAt)
  })

  it('uses viewport offsets and the full camera aspect ratio', () => {
    const { source, lookAt, focus } = createFocus()
    source.value = { x: 500, y: 50 }
    const target = focus().clone().sub(lookAt.getLookAtWorldPosition(new Vector3()))
    expect(Math.abs(target.x / target.y)).toBeCloseTo(2)
  })

  it('does not change gaze when the camera near clipping plane changes', () => {
    const { source, camera, focus } = createFocus()
    source.value = { x: 450, y: 75 }
    const before = focus().clone()
    camera.near = 0.5
    camera.updateProjectionMatrix()
    expect(focus().distanceTo(before)).toBeLessThan(1e-10)
  })

  it('reads animated head translation without another pointer event', () => {
    const { vrm, focus } = createFocus()
    const before = focus().clone()
    vrm.humanoid.getRawBoneNode('head')!.position.y += 0.4
    vrm.scene.updateMatrixWorld(true)
    expect(focus().y - before.y).toBeCloseTo(0.4)
  })

  it('follows camera rotation without another pointer event', () => {
    const { camera, lookAt, focus } = createFocus()
    camera.position.set(-2, 1.5, 0)
    camera.lookAt(0, 1.5, 0)
    const direction = focus().clone().sub(lookAt.getLookAtWorldPosition(new Vector3())).normalize()
    expect(direction.x).toBeCloseTo(-1)
    expect(direction.y).toBeCloseTo(0)
    expect(direction.z).toBeCloseTo(0)
  })

  it('keeps reliable out-of-window coordinates on both axes', () => {
    const { source, lookAt, focus } = createFocus()
    source.value = { x: -100, y: -50 }
    lookAt.lookAt(focus())
    const left = lookAt.yaw
    expect(Math.abs(left)).toBeGreaterThan(40)
    expect(lookAt.pitch).toBeLessThan(-15)
    source.value = { x: 700, y: 350 }
    lookAt.lookAt(focus())
    expect(lookAt.yaw).toBeCloseTo(-left)
    expect(lookAt.pitch).toBeGreaterThan(15)
  })

  it('ignores unmeasured bounds and invalid pointer samples', () => {
    const { source, screen, defaultLookAt, focus } = createFocus()
    source.value = { x: Number.NaN, y: 100 }
    expect(focus()).toBe(defaultLookAt)
    source.value = { x: 300, y: 150 }
    screen.value.width = 0
    expect(focus()).toBe(defaultLookAt)
  })
})

describe('eye focus damping', () => {
  it('initializes each model at its requested target without inheriting another model position', () => {
    const first = createFocus()
    const second = createFocus()
    const eyes = new VRMEyeFocus()
    eyes.update(first.lookAt, { x: 1, y: 2, z: -3 }, 1 / 60)
    eyes.update(second.lookAt, { x: -2, y: 3, z: -4 }, 1 / 60)
    expect(first.lookAt.target!.position.toArray()).toEqual([1, 2, -3])
    expect(second.lookAt.target!.position.toArray()).toEqual([-2, 3, -4])
    expect(second.lookAt.target).not.toBe(first.lookAt.target)
  })

  it('interpolates without overshoot and leaves look-at evaluation to the frame owner', () => {
    const { lookAt } = createFocus()
    const eyes = new VRMEyeFocus()
    const update = vi.spyOn(lookAt, 'update')
    eyes.update(lookAt, { x: 0, y: 1.5, z: -2 }, 1 / 60)
    eyes.update(lookAt, { x: 1, y: 2.5, z: -2 }, 1 / 60)
    expect(lookAt.target!.position.x).toBeGreaterThan(0)
    expect(lookAt.target!.position.x).toBeLessThan(1)
    expect(lookAt.target!.position.y).toBeGreaterThan(1.5)
    expect(lookAt.target!.position.y).toBeLessThan(2.5)
    expect(update).not.toHaveBeenCalled()
  })

  it('has equal damping at 30, 60, and 144 frames per second', () => {
    const results = [30, 60, 144].map((fps) => {
      const { lookAt } = createFocus()
      const eyes = new VRMEyeFocus()
      eyes.update(lookAt, { x: 0, y: 1, z: -2 }, 0)
      for (let frame = 0; frame < fps / 2; frame++)
        eyes.update(lookAt, { x: 1, y: 2, z: -3 }, 1 / fps)
      return lookAt.target!.position.clone()
    })
    expect(results[0].distanceTo(results[1])).toBeLessThan(1e-12)
    expect(results[0].distanceTo(results[2])).toBeLessThan(1e-12)
    expect(results[0].x).toBeCloseTo(1 - Math.exp(-10), 12)
  })

  it('preserves a replaced parented target and smooths its world coordinates', () => {
    const { lookAt } = createFocus()
    const eyes = new VRMEyeFocus()
    eyes.update(lookAt, { x: 0, y: 1, z: -2 }, 0)
    const parent = new Object3D()
    parent.position.set(2, 3, 4)
    parent.rotation.set(0, Math.PI / 2, 0)
    const replacement = new Object3D()
    parent.add(replacement)
    lookAt.target = replacement
    const start = replacement.getWorldPosition(new Vector3())
    const destination = new Vector3(1, 2, -3)
    eyes.update(lookAt, destination, 0.05)
    expect(lookAt.target).toBe(replacement)
    const expected = start.lerp(destination, 1 - Math.exp(-1))
    expect(replacement.getWorldPosition(new Vector3()).distanceTo(expected)).toBeLessThan(1e-12)
  })

  it('does not move for invalid or paused frame deltas', () => {
    const { lookAt } = createFocus()
    const eyes = new VRMEyeFocus()
    eyes.update(lookAt, { x: 0, y: 1, z: -2 }, 0)
    for (const delta of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      eyes.update(lookAt, { x: 1, y: 2, z: -3 }, delta)
    expect(lookAt.target!.position.toArray()).toEqual([0, 1, -2])
  })
})
