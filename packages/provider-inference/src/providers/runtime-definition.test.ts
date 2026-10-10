import type { ProviderConfigContext, ProviderDefinition, ProviderInstance } from '../types'

import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'

import { getValidatorsOfProvider, validateProvider } from '../validators/run'
import { createProviderRegistry, defineProvider } from './registry'

const context = { t: (key: string) => key }
const instance: ProviderInstance = {
  speech: (model: string) => ({ apiKey: 'test', baseURL: 'https://example.test/v1/', model }),
}
const schema = z.object({
  token: z.string().trim().min(1),
  region: z.string().default('default-region'),
  retries: z.coerce.number().default(2),
})
type Config = z.output<typeof schema>

function definition(overrides: Partial<ProviderDefinition<Config, 'typed'>> = {}) {
  return defineProvider<Config, 'typed'>({
    id: 'typed',
    name: 'Typed',
    nameLocalize: () => 'Typed',
    description: '',
    descriptionLocalize: () => '',
    tasks: ['speech'],
    createProviderConfig: () => schema,
    createProvider: () => instance,
    validationRequiredWhen: draft => typeof draft.token === 'string' && draft.token.trim().length > 0,
    ...overrides,
  })
}

describe('typed provider registration', () => {
  it('preserves configuration types for literal and narrowed registry identities', () => {
    const text = definition()
    const numeric = defineProvider({
      id: 'numeric',
      name: 'Numeric',
      nameLocalize: () => 'Numeric',
      description: '',
      descriptionLocalize: () => '',
      tasks: [],
      createProviderConfig: () => z.object({ value: z.number() }),
      createProvider: (_config: { value: number }) => instance,
    })
    const registry = createProviderRegistry([text, numeric])
    const typed = registry.get('typed')!
    const number = registry.get('numeric')!

    expectTypeOf(typed.createProvider).parameter(0).toEqualTypeOf<Config>()
    expectTypeOf(number.createProvider).parameter(0).toEqualTypeOf<{ value: number }>()
    expectTypeOf<{ token: number }>().not.toExtend<Parameters<typeof typed.createProvider>[0]>()
    for (const entry of registry.list()) {
      if (entry.id === 'typed')
        expectTypeOf(entry.createProvider).parameter(0).toEqualTypeOf<Config>()
    }
    expect(typed).toBe(text)
    expect(number).toBe(numeric)
    expect(registry.get('missing')).toBeUndefined()
    expect(() => createProviderRegistry([text, text])).toThrow('registered more than once')
  })
})

describe('runtime provider configuration boundary', () => {
  it('rejects malformed persisted values before creating a provider', async () => {
    const createProvider = vi.fn((_config: Config) => instance)
    const { runtime } = definition({ createProvider })

    await expect(runtime.createProvider({ token: 42 })).rejects.toThrow()
    await expect(runtime.createProvider({})).rejects.toThrow()
    expect(createProvider).not.toHaveBeenCalled()
  })

  it('preserves schema defaults and transforms while retaining request extras', async () => {
    const createProvider = vi.fn((_config: Config) => instance)
    const { runtime } = definition({ createProvider })
    const saved = { token: ' secret ', retries: '3', model: 'chosen-model', custom: { enabled: true } }

    await expect(runtime.createProvider(saved)).resolves.toBe(instance)
    expect(createProvider).toHaveBeenCalledWith({
      token: 'secret',
      region: 'default-region',
      retries: 3,
      model: 'chosen-model',
      custom: { enabled: true },
    })
    expect(saved.token).toBe(' secret ')
    expect(saved.retries).toBe('3')
  })

  it('does not restore declared fields removed by transforms', async () => {
    const createProvider = vi.fn((_config: { optional?: string }) => instance)
    const provider = defineProvider({
      id: 'optional',
      name: 'Optional',
      nameLocalize: () => 'Optional',
      description: '',
      descriptionLocalize: () => '',
      tasks: [],
      createProviderConfig: () => z.object({ optional: z.preprocess(() => undefined, z.string().optional()) }).overwrite(() => ({})),
      createProvider,
    })

    await provider.runtime.createProvider({ optional: 42, model: 'chosen-model' })
    expect(createProvider).toHaveBeenCalledWith({ model: 'chosen-model' })
  })

  it('keeps explicit catch-all and strict schema policies authoritative', async () => {
    const createProvider = vi.fn((_config: Record<string, string>) => instance)
    const provider = defineProvider({
      id: 'catchall',
      name: 'Catch-all',
      nameLocalize: () => 'Catch-all',
      description: '',
      descriptionLocalize: () => '',
      tasks: [],
      createProviderConfig: () => z.object({}).catchall(z.string().trim()),
      createProvider,
    })

    await provider.runtime.createProvider({ model: ' selected ' })
    expect(createProvider).toHaveBeenCalledWith({ model: 'selected' })
    await expect(provider.runtime.createProvider({ model: 42 })).rejects.toThrow()
    expect(createProvider).toHaveBeenCalledTimes(1)

    const strict = definition({ createProviderConfig: () => schema.strict() })
    await expect(strict.runtime.createProvider({ token: 'valid', extra: true })).rejects.toThrow()
  })

  it('keeps incomplete draft readiness and voice selection synchronous without constructing schemas', () => {
    const createProviderConfig = vi.fn(() => schema)
    const { runtime } = definition({
      createProviderConfig,
      extraMethods: { voiceCatalogConfig: draft => ({ token: draft.token }) },
    })

    expect(runtime.validationRequiredWhen?.({})).toBe(false)
    expect(runtime.validationRequiredWhen?.({ token: 123 })).toBe(false)
    expect(runtime.validationRequiredWhen?.({ token: ' secret ' })).toBe(true)
    expect(runtime.extraMethods?.voiceCatalogConfig?.({ token: 123, retries: 'bad' })).toEqual({ token: 123 })
    expect(createProviderConfig).not.toHaveBeenCalled()
  })

  it('forwards raw editor drafts and awaits async schema factories without requesting editor discovery during execution', async () => {
    const discovery = vi.fn()
    const createProviderConfig = vi.fn(async (options: ProviderConfigContext<Config>) => {
      if (options.config)
        discovery(options.config)
      await Promise.resolve()
      return schema
    })
    const { runtime } = definition({ createProviderConfig })
    const draft = { token: 42 }

    expect(await runtime.createProviderConfig({ ...context, config: draft })).toBe(schema)
    expect(discovery).toHaveBeenCalledWith(draft)
    discovery.mockClear()
    await expect(runtime.createProvider({ token: 'valid' })).resolves.toBe(instance)
    expect(discovery).not.toHaveBeenCalled()
    expect(createProviderConfig).toHaveBeenCalledTimes(2)
  })

  it('validates every async extra method and preserves its additional arguments', async () => {
    const listModels = vi.fn(async (_config: Config, _provider: ProviderInstance, _context?: typeof context) => [])
    const listModelCatalog = vi.fn(async (_config: Config) => ({ models: [] }))
    const listVoices = vi.fn(async (_config: Config, _provider: ProviderInstance, _model?: string, _signal?: AbortSignal) => [])
    const loadModel = vi.fn(async (_config: Config) => {})
    const { runtime } = definition({ extraMethods: { listModels, listModelCatalog, listVoices, loadModel } })
    const methods = runtime.extraMethods!
    const config = { token: ' secret ' }
    const parsed = { token: 'secret', region: 'default-region', retries: 2 }
    const controller = new AbortController()

    await methods.listModels!(config, instance, context)
    await methods.listModelCatalog!(config, instance, context)
    await methods.listVoices!(config, instance, 'voice-model', controller.signal)
    await methods.loadModel!(config, instance)
    expect(listModels).toHaveBeenCalledWith(parsed, instance, context)
    expect(listModelCatalog).toHaveBeenCalledWith(parsed, instance, context)
    expect(listVoices).toHaveBeenCalledWith(parsed, instance, 'voice-model', controller.signal)
    expect(loadModel).toHaveBeenCalledWith(parsed, instance, undefined)

    await expect(methods.listModels!({ token: false }, instance)).rejects.toThrow()
    await expect(methods.listModelCatalog!({ token: false }, instance)).rejects.toThrow()
    await expect(methods.listVoices!({ token: false }, instance)).rejects.toThrow()
    await expect(methods.loadModel!({ token: false }, instance)).rejects.toThrow()
    expect(listModels).toHaveBeenCalledTimes(1)
    expect(listModelCatalog).toHaveBeenCalledTimes(1)
    expect(listVoices).toHaveBeenCalledTimes(1)
    expect(loadModel).toHaveBeenCalledTimes(1)
  })

  it('does not start voice discovery when its signal aborts during schema creation', async () => {
    const schemaReady = Promise.withResolvers<void>()
    const listVoices = vi.fn(async (_config: Config) => [])
    const { runtime } = definition({
      createProviderConfig: async () => {
        await schemaReady.promise
        return schema
      },
      extraMethods: { listVoices },
    })
    const controller = new AbortController()
    const voices = runtime.extraMethods!.listVoices!({ token: 'valid' }, instance, undefined, controller.signal)

    controller.abort()
    schemaReady.resolve()
    await expect(voices).rejects.toThrow()
    expect(listVoices).not.toHaveBeenCalled()
  })

  it.each([true, false])('reports schema errors through validation steps with config checks: %s', async (includeConfigCheck) => {
    const result = { valid: true, errors: [], reason: '', reasonKey: '' }
    const createProvider = vi.fn((_config: Config) => instance)
    const configValidator = vi.fn(async () => result)
    const runtimeValidator = vi.fn(async () => result)
    const { runtime } = definition({
      createProvider,
      validators: {
        validateConfig: includeConfigCheck ? [() => ({ id: 'config', name: 'Config', validator: configValidator })] : [],
        validateProvider: [() => ({ id: 'runtime', name: 'Runtime', validator: runtimeValidator })],
      },
    })
    const plan = await getValidatorsOfProvider({ definition: runtime, config: { token: 42 }, schemaDefaults: {}, contextOptions: context })

    await expect(validateProvider(plan, context)).resolves.toBe(plan.steps)
    expect(plan.steps.every(step => step.status === 'invalid')).toBe(true)
    expect(plan.steps[0].reason).not.toBe('')
    expect(configValidator).not.toHaveBeenCalled()
    expect(runtimeValidator).not.toHaveBeenCalled()
    expect(createProvider).not.toHaveBeenCalled()
  })

  it('validates both validator kinds and binds runtime validators to their typed extra methods', async () => {
    const result = { valid: true, errors: [], reason: '', reasonKey: '' }
    const configValidator = vi.fn(async (_config: Config) => result)
    const listModels = vi.fn(async (_config: Config) => [])
    const runtimeValidator = vi.fn(async (config: Config, provider: ProviderInstance, methods: NonNullable<ProviderDefinition<Config>['extraMethods']>) => {
      await methods.listModels?.(config, provider)
      return result
    })
    const { runtime } = definition({
      extraMethods: { listModels },
      validators: {
        validateConfig: [() => ({ id: 'config', name: 'Config', validator: configValidator })],
        validateProvider: [async () => ({ id: 'runtime', name: 'Runtime', schedule: { mode: 'interval', intervalMs: 1000 }, validator: runtimeValidator })],
      },
    })
    const configCheck = await runtime.validators!.validateConfig![0](context)
    const runtimeCheck = await runtime.validators!.validateProvider![0](context)
    const callerListModels = vi.fn(async () => [])
    const config = { token: ' secret ', model: 'selected' }
    const parsed = { token: 'secret', region: 'default-region', retries: 2, model: 'selected' }

    await configCheck.validator(config, context)
    await runtimeCheck.validator(config, instance, { listModels: callerListModels }, context)
    expect(configValidator).toHaveBeenCalledWith(parsed, context)
    expect(listModels).toHaveBeenCalledWith(parsed, instance)
    expect(callerListModels).not.toHaveBeenCalled()
    expect(runtimeCheck.schedule).toEqual({ mode: 'interval', intervalMs: 1000 })
    await expect(configCheck.validator({ token: null }, context)).rejects.toThrow()
    await expect(runtimeCheck.validator({ token: null }, instance, {}, context)).rejects.toThrow()
    expect(configValidator).toHaveBeenCalledTimes(1)
    expect(runtimeValidator).toHaveBeenCalledTimes(1)
  })
})
