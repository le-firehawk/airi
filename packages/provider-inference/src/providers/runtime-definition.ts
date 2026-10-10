import type { ProviderConfigValidator, ProviderContext, ProviderDefinition, ProviderExtraMethods, ProviderRuntimeValidator } from '../types'

import { parseAsync } from 'zod/v4/core'

const untranslatedContext: ProviderContext = { t: value => value }

/**
 * Validates persisted configuration before it reaches a typed provider callback.
 * Draft selectors remain synchronous and accept unvalidated fields.
 * Schema creation omits draft values because execution needs no editor discovery.
 */
export function createRuntimeProviderDefinition<TConfig extends Record<string, unknown>, TId extends string>(
  definition: ProviderDefinition<TConfig, TId>,
): ProviderDefinition<Record<string, unknown>, TId> {
  async function parseConfig(config: Record<string, unknown>, context: ProviderContext = untranslatedContext, signal?: AbortSignal): Promise<TConfig> {
    signal?.throwIfAborted()
    const schema = await definition.createProviderConfig({ t: context.t, abortSignal: signal })
    const parsed = await parseAsync(schema, config)
    signal?.throwIfAborted()
    // Only undeclared request extras survive stripping. Parsed fields retain defaults and transformations, including removed optional values.
    const extras = schema._zod.def.catchall
      ? {}
      : Object.fromEntries(Object.entries(config).filter(([key]) => !Object.hasOwn(schema._zod.def.shape, key)))
    return { ...extras, ...parsed }
  }

  const methods = definition.extraMethods
  const { listModels, listModelCatalog, listVoices, loadModel, voiceCatalogConfig } = methods ?? {}
  const extraMethods: ProviderExtraMethods<Record<string, unknown>> | undefined = methods && {
    voiceCatalogConfig,
    ...(listModels && {
      listModels: async (config, provider, context) => listModels(await parseConfig(config, context), provider, context),
    }),
    ...(listModelCatalog && {
      listModelCatalog: async (config, provider, context) => listModelCatalog(await parseConfig(config, context), provider, context),
    }),
    ...(listVoices && {
      listVoices: async (config, provider, model, signal) => listVoices(await parseConfig(config, untranslatedContext, signal), provider, model, signal),
    }),
    ...(loadModel && {
      loadModel: async (config, provider, hooks) => loadModel(await parseConfig(config), provider, hooks),
    }),
  }

  return {
    ...definition,
    createProvider: async config => definition.createProvider(await parseConfig(config)),
    extraMethods,
    validators: definition.validators && {
      validateConfig: definition.validators.validateConfig?.map(createValidator => async (context): Promise<ProviderConfigValidator<Record<string, unknown>>> => {
        const validator = await createValidator(context)
        return {
          ...validator,
          validator: async (config, context) => validator.validator(await parseConfig(config, context), context),
        }
      }),
      validateProvider: definition.validators.validateProvider?.map(createValidator => async (context): Promise<ProviderRuntimeValidator<Record<string, unknown>>> => {
        const validator = await createValidator(context)
        return {
          ...validator,
          // The typed validator and its extra methods share the same validated configuration contract.
          validator: async (config, provider, _providerExtra, context) => validator.validator(
            await parseConfig(config, context),
            provider,
            methods ?? {},
            context,
          ),
        }
      }),
    },
  }
}
