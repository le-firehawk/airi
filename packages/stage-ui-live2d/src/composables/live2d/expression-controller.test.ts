import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

import { useExpressionStore } from '../../stores/expression-store'
import { useExpressionController } from './expression-controller'

const expressionRefs = [{ Name: 'Happy', File: 'happy.exp3.json' }]
const expressionData = JSON.stringify({
  Type: 'Live2D Expression',
  Parameters: [{ Id: 'ParamMouthForm', Value: 1, Blend: 'Add' }],
})

function createInternalModel(defaultValue = 0) {
  return shallowRef({
    coreModel: {
      getParameterDefaultValueById: () => defaultValue,
      getParameterValueById: () => defaultValue,
    },
  })
}

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

  // ROOT CAUSE:
  // A disposed controller completed an old file read and replaced the current renderer's expressions.
  // Initialization tokens now reject stale reads and restrict shared-store cleanup to its current owner.
  it.each(['resolve', 'reject'] as const)('ignores a disposed controller when its file read later %ss', async (outcome) => {
    setActivePinia(createPinia())
    const staleRead = Promise.withResolvers<string>()
    const oldController = useExpressionController({ internalModel: createInternalModel() })
    const oldLoad = oldController.initialise('model-a', expressionRefs, () => staleRead.promise)
    oldController.dispose()

    const replacement = useExpressionController({ internalModel: createInternalModel(0.5) })
    await replacement.initialise('model-b', expressionRefs, async () => expressionData)

    if (outcome === 'resolve')
      staleRead.resolve(expressionData)
    else
      staleRead.reject(new Error('Old expression read failed'))
    await oldLoad

    const store = useExpressionStore()
    expect(store.modelId).toBe('model-b')
    expect(store.expressions.get('ParamMouthForm')?.modelDefault).toBe(0.5)
  })

  it('keeps the newest initialization when an earlier read finishes last', async () => {
    setActivePinia(createPinia())
    const staleRead = Promise.withResolvers<string>()
    const controller = useExpressionController({ internalModel: createInternalModel() })
    const oldLoad = controller.initialise('model-a', expressionRefs, () => staleRead.promise)
    await controller.initialise('model-b', expressionRefs, async () => expressionData)
    staleRead.resolve(expressionData)
    await oldLoad

    expect(useExpressionStore().modelId).toBe('model-b')
  })

  it('preserves same-ID replacement expressions after repeated old-controller disposal', async () => {
    setActivePinia(createPinia())
    const oldController = useExpressionController({ internalModel: createInternalModel() })
    await oldController.initialise('same-model', expressionRefs, async () => expressionData)
    oldController.dispose()

    const replacement = useExpressionController({ internalModel: createInternalModel(0.5) })
    await replacement.initialise('same-model', expressionRefs, async () => expressionData)
    oldController.dispose()

    const store = useExpressionStore()
    expect(store.modelId).toBe('same-model')
    expect(store.expressions.get('ParamMouthForm')?.modelDefault).toBe(0.5)

    replacement.dispose()
    expect(store.modelId).toBe('')
    expect(store.expressions.size).toBe(0)
  })

  it('stops file reads when the internal model changes during initialization', async () => {
    setActivePinia(createPinia())
    const staleRead = Promise.withResolvers<string>()
    const internalModel = createInternalModel()
    const controller = useExpressionController({ internalModel })
    const readExpFile = vi.fn(() => staleRead.promise)
    const loading = controller.initialise('model-a', [
      ...expressionRefs,
      { Name: 'Sad', File: 'sad.exp3.json' },
    ], readExpFile)
    internalModel.value = createInternalModel(0.5).value
    staleRead.resolve(expressionData)
    await loading

    expect(readExpFile).toHaveBeenCalledTimes(1)
    expect(useExpressionStore().modelId).toBe('')
  })

  it('does not apply replacement expressions to an old renderer', async () => {
    setActivePinia(createPinia())
    const oldController = useExpressionController({ internalModel: createInternalModel() })
    await oldController.initialise('model-a', expressionRefs, async () => expressionData)
    const replacement = useExpressionController({ internalModel: createInternalModel() })
    await replacement.initialise('model-b', expressionRefs, async () => expressionData)
    const store = useExpressionStore()
    store.expressions.get('ParamMouthForm')!.currentValue = 1
    const coreModel = {
      getParameterValueById: () => 0,
      setParameterValueById: vi.fn(),
    }

    oldController.applyExpressions(coreModel)
    expect(coreModel.setParameterValueById).not.toHaveBeenCalled()
    replacement.applyExpressions(coreModel)
    expect(coreModel.setParameterValueById).toHaveBeenCalledWith('ParamMouthForm', 1)
  })
})
