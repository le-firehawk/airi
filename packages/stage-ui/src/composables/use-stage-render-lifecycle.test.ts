import type { PropType } from 'vue'

import type { StageModelRenderer } from '../stores/settings/stage-model'
import type { StageRenderState } from './use-stage-render-lifecycle'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, effectScope, h, ref, shallowRef, useModel, watch } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { useStageRenderLifecycle } from './use-stage-render-lifecycle'

function setup(renderer: StageModelRenderer = 'live2d') {
  const scope = effectScope()
  const state = ref<StageRenderState>('loading')
  const error = shallowRef<Error>()
  const modelRenderer = ref<StageModelRenderer>(renderer)
  const modelId = ref('model-a')
  const modelSrc = ref<string | undefined>('model-a.json')
  const lifecycle = scope.run(() => useStageRenderLifecycle({ state, error, renderer: modelRenderer, modelId, modelSrc }))!
  return { scope, state, error, modelRenderer, modelId, modelSrc, lifecycle }
}

afterEach(() => vi.useRealTimers())

// https://github.com/le-firehawk/airi/actions/runs/38129933366
// ROOT CAUSE:
// Pixi initialization failed while the desktop retained its Loading overlay.
// Renderer errors now end the current attempt. Only a new keyed attempt can recover.
describe('stage render error recovery', () => {
  it('ends loading on error and rejects mounted from the same failed attempt', () => {
    const { scope, state, error, lifecycle } = setup()
    const failedAttempt = lifecycle.attempt.value
    const failure = new Error('WebGL unavailable')

    expect(failedAttempt.fail(failure)).toBe(true)
    expect(error.value).toBe(failure)
    expect(state.value).toBe('pending')

    failedAttempt.updateState('mounted')
    expect(state.value).toBe('pending')
    expect(error.value).toBe(failure)
    scope.stop()
  })

  it('keeps failure terminal before a controlled error model echoes its parent value', () => {
    const scope = effectScope()
    const state = ref<StageRenderState>('loading')
    const parentError = shallowRef<Error>()
    let emittedError: Error | undefined
    const error = computed({
      get: () => parentError.value,
      set: value => emittedError = value,
    })
    const lifecycle = scope.run(() => useStageRenderLifecycle({
      state,
      error,
      renderer: ref('live2d'),
      modelId: ref('model-a'),
      modelSrc: ref('model-a.json'),
    }))!
    const attempt = lifecycle.attempt.value
    const failure = new Error('Pixi failed')
    attempt.fail(failure)
    expect(parentError.value).toBeUndefined()
    expect(emittedError).toBe(failure)
    attempt.updateState('mounted')
    expect(state.value).toBe('pending')
    expect(attempt.fail(new Error('Secondary failure'))).toBe(false)
    expect(emittedError).toBe(failure)
    parentError.value = emittedError
    expect(error.value).toBe(failure)
    scope.stop()
  })

  it('keeps failure terminal through Vue controlled model bindings', async () => {
    const state = ref<StageRenderState>('loading')
    const error = shallowRef<Error>()
    const failure = new Error('Renderer failed')
    const Fixture = defineComponent({
      props: {
        state: { type: String as PropType<StageRenderState>, required: true },
        error: { type: Error },
      },
      emits: ['update:state', 'update:error'],
      setup(props) {
        const controlledError = useModel(props, 'error')
        const lifecycle = useStageRenderLifecycle({
          state: useModel(props, 'state'),
          error: controlledError,
          renderer: ref('live2d'),
          modelId: ref('model-a'),
          modelSrc: ref('model-a.json'),
        })
        const attempt = lifecycle.attempt.value
        attempt.fail(failure)
        expect(controlledError.value).toBeUndefined()
        attempt.updateState('mounted')
        return () => null
      },
    })

    await renderToString(h(Fixture, {
      'state': state.value,
      'error': error.value,
      'onUpdate:state': value => state.value = value,
      'onUpdate:error': value => error.value = value,
    }))
    expect(error.value).toBe(failure)
    expect(state.value).toBe('pending')
  })

  it('revokes mounted state when a running renderer fails', () => {
    const { scope, state, error, lifecycle } = setup()
    lifecycle.attempt.value.updateState('mounted')
    lifecycle.attempt.value.fail(new Error('Render failed'))

    expect(state.value).toBe('pending')
    expect(error.value?.message).toBe('Render failed')
    scope.stop()
  })

  it('resets pending before clearing the error and accepts a successful retry', () => {
    const { scope, state, error, lifecycle } = setup()
    lifecycle.attempt.value.fail(new Error('First attempt failed'))
    const stateWhenErrorCleared: StageRenderState[] = []
    const stop = watch(error, (value) => {
      if (!value)
        stateWhenErrorCleared.push(state.value)
    }, { flush: 'sync' })

    lifecycle.retry()
    expect(stateWhenErrorCleared).toEqual(['pending'])
    expect(error.value).toBeUndefined()
    expect(lifecycle.showStage.value).toBe(true)

    lifecycle.attempt.value.updateState('loading')
    expect(state.value).toBe('loading')
    lifecycle.attempt.value.updateState('mounted')
    expect(state.value).toBe('mounted')
    stop()
    scope.stop()
  })

  it('rejects old callbacks after retry and shows a new attempt failure', () => {
    const { scope, state, error, lifecycle } = setup()
    const oldAttempt = lifecycle.attempt.value
    oldAttempt.fail(new Error('First attempt failed'))
    lifecycle.retry()

    oldAttempt.updateState('mounted')
    expect(oldAttempt.fail(new Error('Late first failure'))).toBe(false)
    expect(error.value).toBeUndefined()
    expect(state.value).toBe('pending')

    lifecycle.attempt.value.fail(new Error('Second attempt failed'))
    expect(error.value?.message).toBe('Second attempt failed')
    scope.stop()
  })

  it.each(['modelId', 'modelSrc', 'modelRenderer'] as const)('replaces the keyed attempt when %s changes', (field) => {
    const fixture = setup()
    const { scope, state, error, lifecycle } = fixture
    const oldAttempt = lifecycle.attempt.value
    oldAttempt.fail(new Error('Old model failed'))
    if (field === 'modelRenderer')
      fixture.modelRenderer.value = 'vrm'
    else
      fixture[field].value = 'model-b'

    expect(lifecycle.attempt.value.generation).not.toBe(oldAttempt.generation)
    expect(error.value).toBeUndefined()
    expect(state.value).toBe('pending')
    oldAttempt.updateState('mounted')
    expect(oldAttempt.fail(new Error('Late old model failure'))).toBe(false)
    expect(state.value).toBe('pending')
    expect(error.value).toBeUndefined()

    lifecycle.attempt.value.updateState('mounted')
    expect(state.value).toBe('mounted')
    scope.stop()
  })

  it.each(['live2d', 'vrm'] as const)('isolates old %s callbacks after source replacement', (renderer) => {
    const { scope, state, error, modelSrc, lifecycle } = setup(renderer)
    const oldAttempt = lifecycle.attempt.value
    modelSrc.value = 'replacement-model'
    const newAttempt = lifecycle.attempt.value
    expect(newAttempt.generation).not.toBe(oldAttempt.generation)
    oldAttempt.updateState('mounted')
    expect(oldAttempt.fail(new Error('Old model failed'))).toBe(false)
    expect(state.value).toBe('pending')
    expect(error.value).toBeUndefined()
    newAttempt.updateState('mounted')
    expect(state.value).toBe('mounted')
    scope.stop()
  })

  it.each(['spine', 'mmd', 'tachie'] as const)('preserves %s source-change state and remounts only on retry', async (renderer) => {
    const { scope, state, error, modelId, modelSrc, lifecycle } = setup(renderer)
    state.value = 'mounted'
    error.value = new Error('Renderer-owned failure')
    modelId.value = 'model-b'
    expect(state.value).toBe('mounted')
    expect(error.value).toBeUndefined()
    expect(lifecycle.showStage.value).toBe(true)
    modelSrc.value = 'model-b-source'
    expect(state.value).toBe('mounted')
    expect(lifecycle.showStage.value).toBe(true)

    const retry = lifecycle.retry()
    expect(lifecycle.showStage.value).toBe(false)
    await retry
    expect(lifecycle.showStage.value).toBe(true)
    scope.stop()
  })

  it('preserves Godot immediate state across identity replacement and retry', async () => {
    const { scope, state, modelId, lifecycle } = setup('godot')
    modelId.value = 'model-b'
    expect(state.value).toBe('mounted')
    await lifecycle.retry()
    expect(state.value).toBe('mounted')
    scope.stop()
  })

  it('reloads an unchanged source with a fresh attempt after the existing delay', async () => {
    vi.useFakeTimers()
    const { scope, state, error, lifecycle } = setup()
    const oldAttempt = lifecycle.attempt.value
    oldAttempt.fail(new Error('Old model failed'))
    const updateModel = vi.fn(async () => {})

    await lifecycle.reload(updateModel)
    expect(updateModel).toHaveBeenCalledOnce()
    expect(lifecycle.showStage.value).toBe(false)
    expect(error.value).toBeUndefined()
    expect(state.value).toBe('pending')
    await vi.advanceTimersByTimeAsync(100)
    expect(lifecycle.showStage.value).toBe(true)
    expect(lifecycle.attempt.value.generation).not.toBe(oldAttempt.generation)
    oldAttempt.updateState('mounted')
    expect(state.value).toBe('pending')
    scope.stop()
  })

  it('cancels a delayed reload when the user retries', async () => {
    vi.useFakeTimers()
    const { scope, state, lifecycle } = setup()
    await lifecycle.reload(async () => {})
    lifecycle.retry()
    const currentAttempt = lifecycle.attempt.value
    currentAttempt.updateState('mounted')

    await vi.advanceTimersByTimeAsync(100)
    expect(lifecycle.attempt.value).toBe(currentAttempt)
    expect(state.value).toBe('mounted')
    expect(lifecycle.showStage.value).toBe(true)
    scope.stop()
  })

  it('ignores an old asynchronous reload rejection after retry', async () => {
    const { scope, state, error, lifecycle } = setup()
    let rejectLoad!: (error: Error) => void
    const pending = lifecycle.reload(() => new Promise<void>((_resolve, reject) => {
      rejectLoad = reject
    }))
    lifecycle.retry()
    const currentAttempt = lifecycle.attempt.value
    currentAttempt.updateState('mounted')
    rejectLoad(new Error('Stale reload failed'))
    await pending

    expect(lifecycle.attempt.value).toBe(currentAttempt)
    expect(state.value).toBe('mounted')
    expect(error.value).toBeUndefined()
    scope.stop()
  })

  it.each(['resolve', 'reject'] as const)('ignores a stale reload %s after model replacement', async (outcome) => {
    vi.useFakeTimers()
    const { scope, state, error, modelSrc, lifecycle } = setup()
    let resolveLoad!: () => void
    let rejectLoad!: (error: Error) => void
    const pending = lifecycle.reload(() => new Promise<void>((resolve, reject) => {
      resolveLoad = resolve
      rejectLoad = reject
    }))
    modelSrc.value = 'model-b.json'
    const replacementAttempt = lifecycle.attempt.value
    replacementAttempt.updateState('mounted')
    if (outcome === 'resolve')
      resolveLoad()
    else
      rejectLoad(new Error('Old model update failed'))
    await pending
    await vi.advanceTimersByTimeAsync(100)

    expect(lifecycle.attempt.value).toBe(replacementAttempt)
    expect(lifecycle.showStage.value).toBe(true)
    expect(state.value).toBe('mounted')
    expect(error.value).toBeUndefined()
    scope.stop()
  })

  it('shows a current reload failure without leaving the stage hidden', async () => {
    const { scope, state, error, lifecycle } = setup()
    await lifecycle.reload(async () => {
      throw new Error('Reload failed')
    })

    expect(lifecycle.showStage.value).toBe(true)
    expect(state.value).toBe('pending')
    expect(error.value?.message).toBe('Reload failed')
    lifecycle.attempt.value.updateState('mounted')
    expect(state.value).toBe('pending')
    scope.stop()
  })

  it('disposes delayed remounts and rejects renderer callbacks after unmount', async () => {
    vi.useFakeTimers()
    const { scope, state, error, lifecycle } = setup()
    await lifecycle.reload(async () => {})
    const oldAttempt = lifecycle.attempt.value
    scope.stop()

    await vi.advanceTimersByTimeAsync(100)
    oldAttempt.updateState('mounted')
    expect(oldAttempt.fail(new Error('Disposed renderer failed'))).toBe(false)
    expect(lifecycle.showStage.value).toBe(false)
    expect(state.value).toBe('pending')
    expect(error.value).toBeUndefined()
    lifecycle.retry()
    expect(lifecycle.showStage.value).toBe(false)
  })

  it('ignores asynchronous model updates that finish after disposal', async () => {
    vi.useFakeTimers()
    const { scope, lifecycle } = setup()
    let resolveLoad!: () => void
    const pending = lifecycle.reload(() => new Promise<void>((resolve) => {
      resolveLoad = resolve
    }))
    scope.stop()
    resolveLoad()
    await pending
    await vi.advanceTimersByTimeAsync(100)

    expect(lifecycle.showStage.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
