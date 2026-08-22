# #81 Document and prove the staging cutover

## Summary

Provide one operator path for staging deployment and release proof. The path must keep infrastructure IDs,
credentials, provider objects, and raw authentication material outside Git. It must reuse the existing WorkOS
and Stripe proofs, run the full local contract matrix, and emit only sanitized evidence.

## Acceptance criteria

- [ ] The runbook covers D1 provisioning and migrations, Worker bindings and secrets, WorkOS redirects,
      Stripe catalog and webhook setup, scheduled retention, observability, rollback-forward, and handoff.
- [ ] Safe proof commands cover auth slots, billing lifecycle, sync and lapse, MCP scopes and revocation,
      retention and purge, and free-use zero-content traffic.
- [ ] Evidence cannot contain tokens, cookies, passwords, reusable personal data, or infrastructure IDs.
- [ ] WorkOS, Stripe, and D1 fixtures have explicit cleanup and zero-remnant checks.
- [ ] Live commands refuse to run without a complete staging-only operator configuration and confirmation.

## TODOs

- [x] Add a fail-closed staging preflight, sanitized evidence writer, and focused contract matrix.
- [x] Compose the existing provider proofs and live deployment checks behind one guarded command.
- [x] Document provisioning, deployment, observation, cleanup, rollback-forward, and production handoff.
- [x] Test the proof tooling and record focused validation for the merger.

## Notes

- Native Safari and Android execution stays in #70. This issue calls the existing retained-slot proof only.
- Staging and production use separate WorkOS and Stripe objects. No proof command accepts live Stripe keys.
- Wrangler environment bindings remain placeholders in Git. The operator supplies real IDs in an ignored file.
- Current primary references were checked on 2026-08-22: Cloudflare D1 migrations, Time Travel, Cron Triggers,
  Workers observability, WorkOS environments and redirect URIs, Stripe webhooks and test clocks, and MCP
  2026-07-28 Streamable HTTP.
- Safety unit proof: `pnpm exec vitest run tests/unit/staging-cutover-proof.spec.ts` passed 11 tests.
- Empty live preflight fails before network or provider access and lists all missing operator inputs.
- Runtime proof cleanup is restartable from a mode-`0600` fixture ledger outside the repository. The ledger
  is removed only after WorkOS, Stripe, and D1 zero-remnant checks pass.
- Composition syntax checks and the focused safety unit proof passed after adding the cleanup ledger.
- WorkOS's documented redirect wildcard contract does not support the current random callback path. Issue #83
  tracks the stable-callback prerequisite; the runbook does not waive the blocked live gate.
- Focused staging safety and MCP contract/authorization/protocol/tools validation passed 46 tests.
- The complete contract command passed 17 files and 119 tests, then passed `test:d1-schema`; its sanitized
  evidence was created with mode `0600` outside the repository.
- `pnpm build` and a staging Wrangler dry-run passed with the expected D1, rate-limit, and asset bindings.
- Aggregate live evidence now rejects a provider's `passed` label if any required check or cleanup fact fails.
- `pnpm validate` passed from a worktree-local frozen install: lint, zero-warning Svelte/type checks, 57 unit
  files and 306 tests, production build, the 185,847/256,000-byte initial-entry budget, and 22 Playwright tests.
- The first E2E attempt exposed a worktree-only dependency symlink outside Vite's filesystem allowlist, which
  prevented font loading and changed one visual snapshot. A frozen local install restored the same dependency
  graph; the failed visual test and the complete validation then passed without tracked application changes.
