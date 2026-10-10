import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { useArtistryStore } from './artistry'

/**
 * @example
 * describe('artistry store', () => {})
 */
describe('artistry store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  /**
   * @example
   * it('defaults to disabled artistry without treating ComfyUI as configured', () => {})
   */
  it('defaults to disabled artistry without treating ComfyUI as configured', () => {
    const artistryStore = useArtistryStore()

    // @example
    expect(artistryStore.globalProvider).toBe('none')
    // @example
    expect(artistryStore.activeProvider).toBe('none')
    // @example
    expect(artistryStore.configured).toBe(false)
  })

  // ROOT CAUSE:
  // Synchronized clones produced equal provider options with different identities. Reflecting
  // global options into active state then broadcast another snapshot indefinitely.
  // Global-to-active resolution is now explicit, and persistence cannot reflect its own write.
  it('does not mutate active options after applying an equal synchronized snapshot', async () => {
    const artistryStore = useArtistryStore()
    artistryStore.globalProviderOptions = { steps: 20 }
    artistryStore.providerOptions = { steps: 20 }
    artistryStore.comfyuiSavedWorkflows = [{
      id: 'workflow-1',
      name: 'Workflow',
      workflow: {},
      exposedFields: {},
    }]
    await nextTick()

    let mutationCount = 0
    const stopSubscription = artistryStore.$subscribe(() => {
      mutationCount += 1
    }, { flush: 'sync' })

    artistryStore.$patch((currentState) => {
      Object.assign(currentState, {
        globalProviderOptions: { steps: 20 },
        providerOptions: { steps: 20 },
        comfyuiSavedWorkflows: [{
          id: 'workflow-1',
          name: 'Workflow',
          workflow: {},
          exposedFields: {},
        }],
      })
    })
    const mutationCountAfterSnapshot = mutationCount

    await nextTick()

    expect(mutationCount).toBe(mutationCountAfterSnapshot)
    stopSubscription()
  })
})
