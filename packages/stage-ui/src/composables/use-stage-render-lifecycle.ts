import type { Ref } from 'vue'

import type { StageModelRenderer } from '../stores/settings/stage-model'

import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'

export type StageRenderState = 'pending' | 'loading' | 'mounted'

/**
 * Owns renderer attempts, error recovery, and delayed view reloads for one stage.
 * Live2D and VRM receive keyed attempts with terminal errors and stale-event guards.
 * Other renderers retain their own source-change state and existing remount-on-retry behavior.
 */
export function useStageRenderLifecycle(options: {
  state: Ref<StageRenderState>
  error: Ref<Error | undefined>
  renderer: Ref<StageModelRenderer>
  modelId: Ref<string>
  modelSrc: Ref<string | undefined>
}) {
  const generation = ref(0)
  const showStage = ref(true)
  let disposed = false
  let reloadRequest = 0
  let reloadTimer: ReturnType<typeof setTimeout> | undefined

  function usesKeyedAttempts() {
    return options.renderer.value === 'live2d' || options.renderer.value === 'vrm'
  }

  function begin() {
    generation.value += 1
    if (usesKeyedAttempts())
      options.state.value = 'pending'
    else if (options.renderer.value === 'godot')
      options.state.value = 'mounted'
    options.error.value = undefined
  }

  const attempt = computed(() => {
    const currentGeneration = generation.value
    let failed = false
    const isCurrent = () => !disposed && currentGeneration === generation.value

    return {
      generation: currentGeneration,
      updateState(state: StageRenderState) {
        if (isCurrent() && !failed)
          options.state.value = state
      },
      fail(error: Error) {
        if (!isCurrent() || failed)
          return false

        failed = true
        options.state.value = 'pending'
        options.error.value = error
        return true
      },
    }
  })

  function cancelReload() {
    reloadRequest += 1
    clearTimeout(reloadTimer)
    reloadTimer = undefined
  }

  async function retry() {
    if (disposed)
      return

    cancelReload()
    const request = reloadRequest
    if (!usesKeyedAttempts()) {
      showStage.value = false
      await nextTick()
      if (disposed || request !== reloadRequest)
        return
    }
    begin()
    showStage.value = true
  }

  async function reload(updateModel: () => Promise<void>) {
    if (disposed)
      return

    cancelReload()
    const request = reloadRequest
    begin()
    showStage.value = false
    try {
      await updateModel()
    }
    catch (error) {
      if (!disposed && request === reloadRequest) {
        showStage.value = true
        attempt.value.fail(error instanceof Error ? error : new Error(String(error)))
      }
      return
    }
    if (disposed || request !== reloadRequest)
      return

    reloadTimer = setTimeout(() => {
      reloadTimer = undefined
      if (disposed || request !== reloadRequest)
        return
      begin()
      showStage.value = true
    }, 100)
  }

  watch([options.renderer, options.modelId, options.modelSrc], () => {
    if (disposed)
      return
    if (usesKeyedAttempts()) {
      void retry()
      return
    }
    // These renderers own source replacement. Do not add a remount or reset their state.
    cancelReload()
    begin()
    showStage.value = true
  }, { flush: 'sync' })

  onScopeDispose(() => {
    disposed = true
    cancelReload()
  })

  return { attempt, showStage, retry, reload }
}
