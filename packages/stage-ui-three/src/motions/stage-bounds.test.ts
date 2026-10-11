import { Box3, Group, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { builtinMotionMetadata } from './catalog'
import { createStageMotionEnvelope, fitStageMotionView, planStageMotion, transformStageOffset } from './stage-bounds'

function stage(width = 1200, height = 900) {
  const root = new Group()
  const camera = new PerspectiveCamera(45, width / height, 0.1, 100)
  camera.position.set(0, 0.9, 5)
  camera.lookAt(0, 0.9, 0)
  camera.updateMatrixWorld(true)
  const bounds = new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.7, 0.2))
  return { root, camera, width, height, manualControl: false, bounds }
}

const run = builtinMotionMetadata.find(entry => entry.id === 'run-circle')!

describe('stage motion bounds', () => {
  it('proposes an explicit full-body fit without changing the camera or its lens', () => {
    const frame = stage(960, 720)
    frame.camera.position.set(0.1, 1.35, -1.5)
    frame.camera.lookAt(0, 1.15, 0)
    const originalPosition = frame.camera.position.clone()
    const originalRotation = frame.camera.quaternion.clone()
    const envelope = frame.bounds.clone()
    for (const metadata of builtinMotionMetadata)
      envelope.union(createStageMotionEnvelope(frame.bounds, metadata, 1.7)!)
    const circle = createStageMotionEnvelope(frame.bounds, run, 1.7)!
    expect(planStageMotion(frame, circle, true)).toBeUndefined()
    const view = fitStageMotionView(frame, envelope, circle)!
    expect(view).toBeDefined()
    expect(frame.camera.position.toArray()).toEqual(originalPosition.toArray())
    expect(frame.camera.quaternion.toArray()).toEqual(originalRotation.toArray())
    frame.camera.position.copy(view.position)
    frame.camera.updateMatrixWorld(true)
    expect(planStageMotion(frame, circle, true)).toBeDefined()
    expect(planStageMotion(frame, envelope, false)).toBeDefined()
    expect(frame.camera.fov).toBe(45)
    expect(frame.camera.zoom).toBe(1)
  })

  it('rejects a fit with too few usable pixels and preserves the current close-up', () => {
    const frame = stage(80, 80)
    const position = frame.camera.position.clone()
    const circle = createStageMotionEnvelope(frame.bounds, run, 1.7)!
    expect(fitStageMotionView(frame, circle, circle)).toBeUndefined()
    expect(frame.camera.position.toArray()).toEqual(position.toArray())
    frame.width = 960
    frame.height = 720
    frame.manualControl = true
    expect(fitStageMotionView(frame, circle, circle)).toBeUndefined()
  })

  it('uses real space in both screen dimensions without moving the camera', () => {
    const frame = stage()
    const cameraPosition = frame.camera.position.clone()
    const envelope = createStageMotionEnvelope(frame.bounds, run, 1.7)!
    const plan = planStageMotion(frame, envelope, true)!
    expect(plan.radius.x * plan.pixelScale.x).toBeGreaterThan(200)
    expect(plan.radius.y * plan.pixelScale.y).toBeGreaterThan(100)
    expect(frame.camera.position.toArray()).toEqual(cameraPosition.toArray())
  })

  it.each([false, true])('keeps the swept envelope inside every viewport edge with transformed placement %s', (transformed) => {
    const frame = stage()
    if (transformed) {
      frame.root.position.set(0.1, -0.1, 0.2)
      frame.root.rotation.set(0.05, 0.35, -0.04)
      frame.root.scale.set(0.9, 0.9, 0.9)
      frame.camera.position.set(1, 1.3, 5)
      frame.camera.lookAt(0, 0.9, 0)
    }
    const envelope = createStageMotionEnvelope(frame.bounds, run, 1.7)!
    const plan = planStageMotion(frame, envelope, true)!
    for (let step = 0; step < 120; step++) {
      const phase = step / 120 * Math.PI * 2
      const offset = transformStageOffset(new Vector3(plan.center.x + Math.cos(phase) * plan.radius.x, plan.center.y + Math.sin(phase) * plan.radius.y, 0), plan.cameraToParent)
      for (const x of [envelope.min.x, envelope.max.x]) {
        for (const y of [envelope.min.y, envelope.max.y]) {
          for (const z of [envelope.min.z, envelope.max.z]) {
            const point = new Vector3(x, y, z).add(offset).applyMatrix4(frame.root.matrixWorld).project(frame.camera)
            expect(Math.abs(point.x)).toBeLessThanOrEqual(1 - 24 / frame.width + 0.000001)
            expect(Math.abs(point.y)).toBeLessThanOrEqual(1 - 24 / frame.height + 0.000001)
          }
        }
      }
    }
  })

  it('rejects cramped, clipped and degenerate stages instead of substituting an in-place jog', () => {
    const narrow = stage(160, 900)
    const envelope = createStageMotionEnvelope(narrow.bounds, run, 1.7)!
    expect(planStageMotion(narrow, envelope, true)).toBeUndefined()
    const normal = stage()
    expect(planStageMotion(normal, envelope, true, 0)).toBeUndefined()
    normal.root.position.x = 8
    expect(planStageMotion(normal, envelope, true)).toBeUndefined()
    normal.root.position.x = 0
    normal.width = Number.NaN
    expect(planStageMotion(normal, envelope, true)).toBeUndefined()
  })

  it('reserves wider imported articulation clearance and permits it when enough room exists', () => {
    const frame = stage()
    const metadata = { ...run, id: 'imported', source: 'imported' as const, rootMotion: undefined }
    const envelope = createStageMotionEnvelope(frame.bounds, metadata, 1.7)!
    expect(envelope.getSize(new Vector3()).y).toBeGreaterThan(5)
    expect(planStageMotion(frame, envelope, false)).toBeUndefined()
    frame.camera.position.z = 20
    expect(planStageMotion(frame, envelope, false)).toBeDefined()
  })
})
