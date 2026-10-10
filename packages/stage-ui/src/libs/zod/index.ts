import type { $ZodType } from 'zod/v4/core'

import { ZodDefault, ZodObject } from 'zod'

// https://github.com/colinhacks/zod/discussions/1953#discussioncomment-14098158
export function getSchemaDefault<T>(schema: $ZodType<T> | null | undefined): Partial<T> {
  if (!(schema instanceof ZodObject))
    return {}

  return Object.fromEntries(
    Object.entries(schema.shape)
      .map(([k, v]) => [k, v instanceof ZodDefault ? v._def.defaultValue : undefined])
      .filter(([, v]) => v !== undefined),
  )
}
