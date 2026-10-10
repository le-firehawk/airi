import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'

import { useExpressionStore } from '../../stores/expression-store'
import { useExpressionController } from './expression-controller'

describe('useExpressionController', () => {
  it('registers expressions with the identity of each loaded model', async () => {
    // ROOT CAUSE:
    // The controller captured the first model ID and registered later models under that identity.
    // We fixed this by passing each completed model load identity to its expression initialization.
    setActivePinia(createPinia())

    const internalModel = shallowRef({
      coreModel: {
        getParameterDefaultValueById: () => 0,
        getParameterValueById: () => 0,
      },
    })
    const controller = useExpressionController({ internalModel })
    const expressionStore = useExpressionStore()
    const expressionRefs = [{ Name: 'Happy', File: 'happy.exp3.json' }]
    const readExpFile = async () => JSON.stringify({
      Type: 'Live2D Expression',
      Parameters: [{ Id: 'ParamMouthForm', Value: 1, Blend: 'Add' }],
    })

    await controller.initialise('model-a', expressionRefs, readExpFile)
    expect(expressionStore.modelId).toBe('model-a')

    await controller.initialise('model-b', expressionRefs, readExpFile)
    expect(expressionStore.modelId).toBe('model-b')
  })
})
