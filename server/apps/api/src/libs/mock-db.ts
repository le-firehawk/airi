import type { Database } from './db'

import { createRequire } from 'node:module'

import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'

import * as fullSchema from '../schemas'

/**
 * Create a mock database for testing purposes.
 *
 * @see https://github.com/drizzle-team/drizzle-orm/issues/4205#issuecomment-2747745901
 */
export async function mockDB(schema: Partial<typeof fullSchema> & Record<string, unknown>) {
  // drizzle-kit's schema API is a CommonJS export. Use Node's resolver for that boundary.
  const require = createRequire(import.meta.url)
  const { pushSchema } = require('drizzle-kit/api') as typeof import('drizzle-kit/api')

  // Use in-memory PGlite with vector extension registered so pgvector columns work
  const client = new PGlite({
    extensions: { vector },
  })

  try {
    // Create Drizzle instance without running full migrations
    const db = drizzle(client, { schema: { ...schema, ...fullSchema } }) satisfies Database

    // Enable pgvector type in this in-memory database before applying schema
    // This mirrors the production pglite initialization which runs:
    //   CREATE EXTENSION IF NOT EXISTS vector;
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`)

    // Sync the in-memory DB with the provided schema definition
    const { apply } = await pushSchema(schema, drizzle(client))
    await apply()

    return db
  }
  catch (error) {
    await client.close()
    throw error
  }
}
