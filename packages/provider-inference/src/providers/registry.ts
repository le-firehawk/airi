import type { ProviderDefinition, RegisteredProviderDefinition } from '../types'

import { createRuntimeProviderDefinition } from './runtime-definition'

/** Fields used for lookup and deterministic display ordering. */
type ProviderRegistration = Pick<ProviderDefinition, 'id' | 'name' | 'order'>

/**
 * A read-only lookup surface that retains each definition's configuration contract.
 * The caller supplies definitions. Provider imports do not change a shared registry.
 */
export interface ProviderRegistry<TDefinition extends ProviderRegistration> {
  get: <TId extends string>(id: TId) => (TDefinition & { id: TId }) | undefined
  list: () => TDefinition[]
}

/** Pairs a typed declaration with an explicit boundary for unvalidated persisted configuration. */
export function defineProvider<TConfig extends Record<string, unknown>, const TId extends string = string>(
  definition: ProviderDefinition<TConfig, TId>,
): RegisteredProviderDefinition<TConfig, TId> {
  return { ...definition, runtime: createRuntimeProviderDefinition(definition) }
}

function hasId<TDefinition extends ProviderRegistration, TId extends string>(
  definition: TDefinition | undefined,
  id: TId,
): definition is TDefinition & { id: TId } {
  return definition?.id === id
}

/**
 * Creates a deterministic provider registry from explicit definitions.
 *
 * @throws {Error} When more than one definition declares the same id.
 */
export function createProviderRegistry<const TDefinitions extends readonly ProviderRegistration[]>(
  definitions: TDefinitions,
): ProviderRegistry<TDefinitions[number]> {
  const definitionsById = new Map<string, TDefinitions[number]>()

  for (const definition of definitions) {
    if (definitionsById.has(definition.id))
      throw new Error(`Provider definition "${definition.id}" is registered more than once.`)

    definitionsById.set(definition.id, definition)
  }

  const sortedDefinitions = [...definitionsById.values()].toSorted((left, right) => {
    if (left.order === undefined && right.order !== undefined)
      return 1
    if (left.order !== undefined && right.order === undefined)
      return -1
    if (left.order !== undefined && right.order !== undefined && left.order !== right.order)
      return left.order - right.order
    if (left.name < right.name)
      return -1
    if (left.name > right.name)
      return 1
    return 0
  })

  return {
    get: (id) => {
      const definition = definitionsById.get(id)
      return hasId(definition, id) ? definition : undefined
    },
    list: () => [...sortedDefinitions],
  }
}

export { createRuntimeProviderDefinition } from './runtime-definition'
