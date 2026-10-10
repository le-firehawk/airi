import { createDrizzle } from '../db'

/** Creates a lazy PostgreSQL handle. Tests must stub queries before use. */
export function createTestDatabase() {
  return createDrizzle({
    DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
    DB_POOL_MAX: 1,
    DB_POOL_IDLE_TIMEOUT_MS: 1000,
    DB_POOL_CONNECTION_TIMEOUT_MS: 1000,
    DB_POOL_KEEPALIVE_INITIAL_DELAY_MS: 1000,
  }).db
}
