import { describe, expect, it } from 'vitest'

import { shouldSampleStageTransparency } from '../utils/stage-three-transparency'
import { createDefaultWindowLifecycleState, shouldPauseStageFromLifecycle } from './stage-window-lifecycle'

describe('stage window lifecycle helpers', () => {
  it('pauses only for minimized window lifecycle states', () => {
    expect(shouldPauseStageFromLifecycle({
      ...createDefaultWindowLifecycleState(),
      reason: 'show',
      visible: true,
    })).toBe(false)

    expect(shouldPauseStageFromLifecycle({
      ...createDefaultWindowLifecycleState(),
      reason: 'restore',
      visible: true,
    })).toBe(false)

    expect(shouldPauseStageFromLifecycle({
      ...createDefaultWindowLifecycleState(),
      reason: 'hide',
      visible: false,
    })).toBe(false)

    expect(shouldPauseStageFromLifecycle({
      ...createDefaultWindowLifecycleState(),
      minimized: true,
      reason: 'minimize',
    })).toBe(true)
  })

  it('keeps a background stage active beyond 60 seconds and resumes immediately after minimization', () => {
    const background = {
      ...createDefaultWindowLifecycleState(),
      focused: false,
      reason: 'blur' as const,
      updatedAt: 1000,
    }
    expect(shouldPauseStageFromLifecycle(background)).toBe(false)
    expect(shouldPauseStageFromLifecycle({ ...background, updatedAt: 62_000 })).toBe(false)
    expect(shouldPauseStageFromLifecycle({ ...background, minimized: true, reason: 'minimize', updatedAt: 63_000 })).toBe(true)
    expect(shouldPauseStageFromLifecycle({ ...background, focused: true, reason: 'restore', updatedAt: 124_000 })).toBe(false)
  })

  it('samples stage transparency for a mounted vrm stage regardless of Auto Hide', () => {
    expect(shouldSampleStageTransparency({
      componentState: 'mounted',
      stageModelRenderer: 'vrm',
      stagePaused: false,
    })).toBe(true)

    expect(shouldSampleStageTransparency({
      componentState: 'loading',
      stageModelRenderer: 'vrm',
      stagePaused: false,
    })).toBe(false)

    expect(shouldSampleStageTransparency({
      componentState: 'mounted',
      stageModelRenderer: 'live2d',
      stagePaused: false,
    })).toBe(false)

    expect(shouldSampleStageTransparency({
      componentState: 'mounted',
      stageModelRenderer: 'vrm',
      stagePaused: true,
    })).toBe(false)
  })
})
