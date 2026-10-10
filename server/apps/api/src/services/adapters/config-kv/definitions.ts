import type { InferOutput } from 'valibot'

import { any, array, boolean, check, finite, integer, minValue, nonEmpty, number, object, optional, picklist, pipe, record, regex, string } from 'valibot'

import { generationProtocolSchema } from '../../../schemas/generation-protocol'
import { costPricingSchema } from '../../domain/billing/billing'

/**
 * LLM/TTS router config tree. Single composite entry under configKV holds the
 * entire routing surface: per-model upstream list, optional candidate groups,
 * per-upstream key array (envelope-encrypted ciphertexts), transition policies,
 * and default timeouts.
 *
 * Schema enforces:
 * - key entry id must not contain `|` — the envelope-crypto AAD uses `|` as
 *   a reserved separator between `modelName` and `keyEntryId`.
 * - keys array is non-empty per upstream (an upstream with zero keys can
 *   never serve a request and is almost certainly an admin mistake).
 *
 * Defaults at this layer apply when the admin omits the `defaults` object;
 * the router service is responsible for surfacing CONFIG_NOT_SET when the
 * whole `LLM_ROUTER_CONFIG` entry is absent.
 */
export const fallbackTriggersSchema = optional(
  object({
    httpCodes: optional(array(number()), [401, 402, 403, 429, 500, 502, 503, 504]),
    onTimeout: optional(boolean(), true),
  }),
  { httpCodes: [401, 402, 403, 429, 500, 502, 503, 504], onTimeout: true },
)

/**
 * Explicit allow-list for one routing transition.
 *
 * Unlike {@link fallbackTriggersSchema}, this contract has no permissive
 * defaults: an omitted status or timeout never authorizes a transition across
 * a configured routing boundary.
 */
export const routeFailureTriggersSchema = object({
  httpCodes: optional(array(number()), []),
  onTimeout: optional(boolean(), false),
})

export const keyEntrySchema = object({
  id: pipe(
    string(),
    nonEmpty('keys[].id must not be empty'),
    regex(/^[^|]+$/, 'keys[].id must not contain "|" (reserved AAD separator)'),
  ),
  ciphertext: pipe(string(), nonEmpty('keys[].ciphertext must not be empty')),
})

export const llmUpstreamSchema = object({
  /** Supported wire protocols. Omission permits Chat Completions only. */
  protocols: optional(array(generationProtocolSchema)),
  id: optional(pipe(
    string(),
    nonEmpty('llm.upstreams[].id must not be empty'),
    regex(/^[^|]+$/, 'llm.upstreams[].id must not contain "|"'),
  )),
  baseURL: pipe(string(), nonEmpty('llm.upstreams[].baseURL must not be empty')),
  overrideModel: optional(string()),
  keys: pipe(array(keyEntrySchema), check(v => v.length >= 1, 'llm.upstreams[].keys must contain at least 1 entry')),
  headerTemplate: optional(string(), 'Bearer {KEY}'),
  timeoutMs: optional(number()),
})

export const llmRoutingGroupSchema = object({
  id: pipe(string(), nonEmpty('llm.routing.groups[].id must not be empty')),
  upstreamIds: pipe(
    array(pipe(string(), nonEmpty('llm.routing.groups[].upstreamIds[] must not be empty'))),
    check(v => v.length >= 1, 'llm.routing.groups[].upstreamIds must contain at least 1 entry'),
    check(v => new Set(v).size === v.length, 'llm.routing.groups[].upstreamIds must be unique'),
  ),
  retryOn: routeFailureTriggersSchema,
  continueOn: optional(routeFailureTriggersSchema),
})

export const llmRoutingSchema = object({
  groups: pipe(
    array(llmRoutingGroupSchema),
    check(v => v.length >= 1, 'llm.routing.groups must contain at least 1 entry'),
    check(v => new Set(v.map(group => group.id)).size === v.length, 'llm.routing.groups[].id must be unique'),
  ),
})

export const llmModelSchema = pipe(
  object({
    upstreams: pipe(array(llmUpstreamSchema), check(v => v.length >= 1, 'llm.models[].upstreams must contain at least 1 entry')),
    routing: optional(llmRoutingSchema),
    fallbackTriggers: fallbackTriggersSchema,
  }),
  check((model) => {
    if (model.routing == null)
      return true
    const upstreamIds = model.upstreams.map(upstream => upstream.id)
    return upstreamIds.every(id => id != null)
      && new Set(upstreamIds).size === upstreamIds.length
  }, 'llm.models[].upstreams must have unique ids when routing is configured'),
  check((model) => {
    if (model.routing == null)
      return true
    const upstreamIds = new Set(model.upstreams.map(upstream => upstream.id))
    const referencedIds = model.routing.groups.flatMap(group => group.upstreamIds)
    return referencedIds.length === upstreamIds.size
      && new Set(referencedIds).size === referencedIds.length
      && referencedIds.every(id => upstreamIds.has(id))
  }, 'llm.routing.groups must reference every upstream id exactly once'),
)

const ttsProviderSchema = picklist(['azure', 'dashscope-cosyvoice', 'stepfun', 'volcengine'])
const asrProviderSchema = picklist(['aliyun-nls'])

export const ttsUpstreamSchema = object({
  id: optional(pipe(
    string(),
    nonEmpty('tts.upstreams[].id must not be empty'),
    regex(/^[^|]+$/, 'tts.upstreams[].id must not contain "|"'),
  )),
  baseURL: pipe(string(), nonEmpty('tts.upstreams[].baseURL must not be empty')),
  keys: pipe(array(keyEntrySchema), check(v => v.length >= 1, 'tts.upstreams[].keys must contain at least 1 entry')),
  adapterParams: optional(record(string(), any()), {}),
  // One upstream represents one provider app_id.
  // A concurrency cap on any upstream enables capacity-aware routing across pools.
  // Without caps, the model keeps fixed-order fallback and makes no capacity-tracking Redis calls.
  maxConcurrency: optional(pipe(number(), check(v => v >= 1, 'tts.upstreams[].maxConcurrency must be >= 1 when set'))),
})

export const ttsRoutingGroupSchema = object({
  id: pipe(string(), nonEmpty('tts.routing.groups[].id must not be empty')),
  upstreamIds: pipe(
    array(pipe(string(), nonEmpty('tts.routing.groups[].upstreamIds[] must not be empty'))),
    check(v => v.length >= 1, 'tts.routing.groups[].upstreamIds must contain at least 1 entry'),
    check(v => new Set(v).size === v.length, 'tts.routing.groups[].upstreamIds must be unique'),
  ),
  strategy: optional(picklist(['ordered', 'least-inflight']), 'ordered'),
  retryOn: routeFailureTriggersSchema,
  continueOn: optional(routeFailureTriggersSchema),
})

export const ttsRoutingSchema = object({
  groups: pipe(
    array(ttsRoutingGroupSchema),
    check(v => v.length >= 1, 'tts.routing.groups must contain at least 1 entry'),
    check(v => new Set(v.map(group => group.id)).size === v.length, 'tts.routing.groups[].id must be unique'),
  ),
})

export const streamingTtsUpstreamSchema = object({
  baseURL: pipe(string(), nonEmpty('UNSPEECH_UPSTREAM.streaming.baseURL must not be empty')),
  keys: pipe(array(keyEntrySchema), check(v => v.length >= 1, 'UNSPEECH_UPSTREAM.streaming.keys must contain at least 1 entry')),
  adapterParams: optional(record(string(), any()), {}),
  models: optional(
    array(object({
      id: pipe(string(), nonEmpty('UNSPEECH_UPSTREAM.streaming.models[].id must not be empty')),
      name: optional(string()),
      description: optional(string()),
    })),
    [],
  ),
  defaultModel: optional(pipe(
    string(),
    nonEmpty('UNSPEECH_UPSTREAM.streaming.defaultModel must not be empty'),
  )),
})

export const unspeechUpstreamSchema = object({
  restBaseURL: pipe(string(), nonEmpty('UNSPEECH_UPSTREAM.restBaseURL must not be empty')),
  streaming: optional(streamingTtsUpstreamSchema),
})

export const ttsModelSchema = pipe(
  object({
    provider: ttsProviderSchema,
    upstreams: pipe(array(ttsUpstreamSchema), check(v => v.length >= 1, 'tts.models[].upstreams must contain at least 1 entry')),
    routing: optional(ttsRoutingSchema),
    fallbackTriggers: fallbackTriggersSchema,
  }),
  check((model) => {
    if (model.routing == null)
      return true
    const upstreamIds = model.upstreams.map(upstream => upstream.id)
    return upstreamIds.every(id => id != null)
      && new Set(upstreamIds).size === upstreamIds.length
  }, 'tts.models[].upstreams must have unique ids when routing is configured'),
  check((model) => {
    if (model.routing == null)
      return true
    const upstreamIds = new Set(model.upstreams.map(upstream => upstream.id))
    const referencedIds = model.routing.groups.flatMap(group => group.upstreamIds)
    return referencedIds.length === upstreamIds.size
      && new Set(referencedIds).size === referencedIds.length
      && referencedIds.every(id => upstreamIds.has(id))
  }, 'tts.routing.groups must reference every upstream id exactly once'),
  check((model) => {
    if (model.routing == null)
      return true
    const upstreamById = new Map(model.upstreams.map(upstream => [upstream.id, upstream]))
    return model.routing.groups.every(group =>
      group.strategy !== 'least-inflight'
      || group.upstreamIds.every(id => upstreamById.get(id)?.maxConcurrency != null),
    )
  }, 'tts.routing least-inflight groups require maxConcurrency on every upstream'),
)

export const asrUpstreamSchema = object({
  keys: pipe(array(keyEntrySchema), check(v => v.length >= 1, 'asr.upstreams[].keys must contain at least 1 entry')),
  adapterParams: optional(record(string(), any()), {}),
})

export const asrModelSchema = object({
  provider: asrProviderSchema,
  upstreams: pipe(array(asrUpstreamSchema), check(v => v.length >= 1, 'asr.models[].upstreams must contain at least 1 entry')),
})

export const llmRouterDefaultsSchema = optional(
  object({
    perAttemptTimeoutMs: optional(number(), 30000),
    fullChainTimeoutMs: optional(number(), 60000),
    fallbackHttpCodes: optional(array(number()), [401, 402, 403, 429, 500, 502, 503, 504]),
  }),
  { perAttemptTimeoutMs: 30000, fullChainTimeoutMs: 60000, fallbackHttpCodes: [401, 402, 403, 429, 500, 502, 503, 504] },
)

export const llmRouterConfigSchema = object({
  llm: object({
    models: record(string(), llmModelSchema),
  }),
  tts: object({
    models: record(string(), ttsModelSchema),
  }),
  asr: optional(object({
    models: record(string(), asrModelSchema),
  })),
  defaults: llmRouterDefaultsSchema,
})

/**
 * Config entry schemas are the single source of truth for:
 * - runtime validation
 * - default values
 * - stored JSON shape
 */
export const configEntrySchemas = {
  LLM_COST_BILLING: record(pipe(string(), nonEmpty()), costPricingSchema),
  LLM_MINIMUM_BALANCE: optional(pipe(number(), finite(), integer(), minValue(1)), 5),
  INITIAL_USER_FLUX: optional(number(), 0),
  FLUX_PER_1K_CHARS_TTS: number(),
  // App Store product id → Flux amount to grant. AIRI and AIRI Lite each have
  // their own product ids.
  APPLE_FLUX_PACKS: optional(record(
    pipe(string(), nonEmpty('APPLE_FLUX_PACKS product ids must not be empty')),
    object({
      fluxAmount: pipe(number(), minValue(1, 'APPLE_FLUX_PACKS fluxAmount must be >= 1')),
    }),
  ), {}),
  // No default — absent means top-up is not available yet
  STRIPE_FLUX_PRODUCT_ID: optional(string()),
  // No default — absent lets Stripe auto-select payment methods via Dashboard config
  STRIPE_PAYMENT_METHODS: optional(array(string())),
  STRIPE_PAYMENT_METHOD_OPTIONS: optional(record(string(), any()), {}),
  // Maps model IDs and BCP-47 locales to recommended voice IDs for client selection.
  // REST keys use router TTS model IDs. Streaming keys use api_resource_id values.
  // These key spaces do not overlap.
  DEFAULT_TTS_VOICES: optional(record(string(), record(string(), string())), {}),
  // Resolves auto before router dispatch. Each value must name an existing LLM_ROUTER_CONFIG model.
  // Missing values produce CONFIG_NOT_SET instead of routing an empty model name.
  // Keep the schema required so successful lookups return string, without undefined.
  DEFAULT_CHAT_MODEL: pipe(string(), nonEmpty('DEFAULT_CHAT_MODEL must not be empty')),
  DEFAULT_TTS_MODEL: pipe(string(), nonEmpty('DEFAULT_TTS_MODEL must not be empty')),
  // No default — the router throws CONFIG_NOT_SET when this entry is absent
  // so deployment configuration must populate it before traffic flows.
  LLM_ROUTER_CONFIG: optional(llmRouterConfigSchema),
  // Single unspeech deployment used for every TTS surface: REST audio/speech,
  // REST voices catalog, ws audio/speech/stream. `streaming` is optional —
  // operator may run REST-only without the ws upstream. `streaming.keys`
  // carry the upstream-provider API key (Volcengine X-Api-Key), not an
  // unspeech tenant token (unspeech itself is unauthenticated).
  UNSPEECH_UPSTREAM: optional(unspeechUpstreamSchema),
} as const

export type ConfigDefinitions = {
  [K in keyof typeof configEntrySchemas]: InferOutput<(typeof configEntrySchemas)[K]>
}

export type ConfigKey = keyof ConfigDefinitions
