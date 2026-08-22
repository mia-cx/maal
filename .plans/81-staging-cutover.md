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
- [~] Compose the existing provider proofs and live deployment checks behind one guarded command.
- [ ] Document provisioning, deployment, observation, cleanup, rollback-forward, and production handoff.
- [ ] Test the proof tooling and record focused validation for the merger.

## Notes

- Native Safari and Android execution stays in #70. This issue calls the existing retained-slot proof only.
- Staging and production use separate WorkOS and Stripe objects. No proof command accepts live Stripe keys.
- Wrangler environment bindings remain placeholders in Git. The operator supplies real IDs in an ignored file.
- Current primary references were checked on 2026-08-22: Cloudflare D1 migrations, Time Travel, Cron Triggers,
  Workers observability, WorkOS environments and redirect URIs, Stripe webhooks and test clocks, and MCP
  2026-07-28 Streamable HTTP.
- Safety unit proof: `pnpm exec vitest run tests/unit/staging-cutover-proof.spec.ts` passed 3 tests.
- Empty live preflight fails before network or provider access and lists all missing operator inputs.
