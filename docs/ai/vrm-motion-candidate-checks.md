# Running a final VRM Motion candidate

Ordinary updates to `le-firehawk/feat/vrm-motion-library` do not start the full Linux packaging workflow.
Finish the local fix batch, review the changed files, and record local lint, typecheck, and test results first. Call out checks that could not run locally.

After explicit approval to spend Actions minutes on the final candidate, create or update a `le-firehawk/candidate/vrm-motion-*` branch at the reviewed commit. That push runs every candidate verification gate and builds artifacts, but cannot publish a release.
Do not update candidate refs for incremental fixes without another approved final validation attempt.

A push to `le-firehawk/release/vrm-motion-v*` remains an intentional publication request. It runs the same verification and packaging gates before the guarded publish job. The exact source SHA, version, architecture, update routing, and checksums must all match.

The candidate workflow uses a dedicated push trigger because a new workflow on a feature branch is not reliably available through `workflow_dispatch` until it exists on the default branch. See [GitHub workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).

Changing triggers locally does not cancel an already-running job or alter the currently published workflow. Existing jobs must be cancelled separately when requested.

The API concurrent-billing integration test requires `BILLING_TEST_DATABASE_URL` pointing to the dedicated local `flux_usage_test` database. Without it, that test keeps its existing explicit skip. A green candidate does not claim that external-Postgres concurrency check ran.


Vitest gates select Vite's module runner explicitly because this monorepo uses extensionless TypeScript imports. This keeps config dependency tracking and avoids depending on the future native-loader default. No native-compatibility warning filter is set.

Godot export and VRM extension regressions save their complete output. A nonzero exit or an engine/script error diagnostic fails the gate, even if Godot itself reports a successful exit. The Linux preset embeds its resource pack, so the gate checks the executable rather than requiring a separate PCK file.

Copilot setup push events exclude only this motion feature branch and its candidate/release branch patterns. Manual dispatch, other branches, and existing tag-push behavior remain available.
