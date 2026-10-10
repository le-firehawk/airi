import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type { Env } from './env'

import { fileURLToPath } from 'node:url'

import pg from 'pg'

import { useLogger } from '@guiiai/logg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

import * as fullSchema from '../schemas'

const logger = useLogger('db')
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

interface PostgreSqlRows<Row> { rows: Row[] }

interface PostgreSqlQueryResult extends PgQueryResultHKT {
  type: PostgreSqlRows<this['row']>
}

/** Shared PostgreSQL query contract, independent of the production or in-memory driver. */
export type Database = PgDatabase<PostgreSqlQueryResult, typeof fullSchema>

type DrizzleEnv = Pick<Env, 'DATABASE_URL' | 'DB_POOL_MAX' | 'DB_POOL_IDLE_TIMEOUT_MS' | 'DB_POOL_CONNECTION_TIMEOUT_MS' | 'DB_POOL_KEEPALIVE_INITIAL_DELAY_MS'>

// NOTICE: pg is imported statically here. The OTEL instrumentation hooks are
// registered via --import ./instrumentation.ts (preload) which runs before
// tsx loads application modules, allowing require-in-the-middle to patch pg.
export function createDrizzle(env: DrizzleEnv) {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: env.DB_POOL_KEEPALIVE_INITIAL_DELAY_MS,
  })

  pool.on('error', (err) => {
    logger.withError(err).error('Unexpected pool error on idle client')
  })

  const db = drizzle(pool, { schema: fullSchema })
  return { db, pool }
}

export async function migrateDatabase(db: ReturnType<typeof createDrizzle>['db']) {
  await migrate(db, { migrationsFolder })
}
