# Preserve types at server test boundaries

Status: accepted

## Decision

Application queries use Drizzle's shared PostgreSQL database contract. Production migration setup keeps its concrete Node/Postgres handle.
The in-memory test driver supplies the same query contract without pretending to own a pg.Pool client. Its known schema keys retain the canonical table types; extra test-only tables remain supported. The contract retains typed rows from raw queries. ConfigKV only needs the select projection; migration setup still requires the concrete production handle.

The ban hook accepts only its required session data and user-lookup context. Better Auth supplies that projection through its complete context.
The returned plugin still satisfies BetterAuthPlugin. Auth routes expose only the callable operations they use. Their rate-limit fixture no longer constructs a live authentication framework or starts its plugins.

## Scope and non-goals

This changes types and test fixtures. It does not change SQL, transactions, ban policy, authentication, or public HTTP responses.
Boundary fixtures use real lazy database handles and spy on external operations without connecting. Database integration tests use in-memory PGlite. Those fixtures retain their concrete client, close it at the owning test or suite boundary, and close failed schema initialization before propagating the error.

## Module graph

```text
Production services -> Database query contract <- PGlite test database
Production migrations -> Node/Postgres database
Better Auth -> ban hook <- typed user-lookup fixture
```

## Affected files

```text
server/apps/api/src/libs/
  db.ts
  mock-db.ts
  tests/db-fixtures.ts
server/apps/api/src/routes/**/*.test.ts
server/apps/api/src/services/
  adapters/config-kv/store.ts
  domain/billing/tests/flux-usage-concurrency.test.ts
  domain/**/*.test.ts
server/apps/auth/src/
  plugins/ban-guard.ts
  routes.ts
  tests/auth-fixtures.ts
  tests/ban-guard.test.ts
  tests/rate-limit.test.ts
```

## Request sequence

```text
Better Auth -> ban hook: session and context
ban hook -> internalAdapter: findUserById
internalAdapter -> ban hook: user ban state
ban hook -> Better Auth: allow or forbidden
Test setup -> mockDB: create in-memory database
mockDB -> test scope: concrete driver plus shared query contract
Test teardown -> PGlite client: close after owning test or suite
Failed schema setup -> PGlite client: close before propagating failure
```

## Test plan

Run API and Auth typechecks. Run database, request-auth, provider, ban, rate-limit, and social-authorization tests.
Run server lint without disabled rules or higher warning limits.
