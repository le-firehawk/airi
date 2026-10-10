import type { AuthEnv } from '../env'

import { createAuthDrizzle } from '../db'
import { parseAuthEnv } from '../env'

/** Creates a complete parsed environment for isolated Auth tests. */
export function createTestAuthEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return {
    ...parseAuthEnv({
      DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
      REDIS_URL: 'redis://127.0.0.1:1',
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      AUTH_GOOGLE_CLIENT_ID: 'google-client',
      AUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
      AUTH_GITHUB_CLIENT_ID: 'github-client',
      AUTH_GITHUB_CLIENT_SECRET: 'github-secret',
    }),
    ...overrides,
  }
}

/** Creates a real lazy database handle. Tests must stub queries before use. */
export function createTestAuthDatabase() {
  return createAuthDrizzle(createTestAuthEnv()).db
}
