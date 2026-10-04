# #88 Fix remaining PR #69 release-review findings

## Summary

Close the remaining billing, deletion, portability, and MCP release gaps without changing the fresh
Drizzle baseline or canonical taxonomy seed.

## Acceptance criteria

- [x] Household deletion enters recovery only after its required Stripe refund succeeds and resumes safely.
- [x] Sync and MCP enforce paid-period deadlines, continuous grace, and recovered-household subscription identity.
- [x] The billing owner cannot be demoted or removed until ownership transfers or billing ends.
- [x] Scheduled maintenance resolves stale trial reservations, rollback resources, and all household recovery rows.
- [x] Stripe webhooks project canonical subscription state without stale same-second restoration.
- [x] Portable import restarts sync and records authoritative replacement deletions.
- [x] MCP recipe propagation intersects paid grants with live and projected `meals:write` permission.
- [x] MCP key create and reroll require paid service, bounded key creation, and canonical UTC expiry.
- [x] Every advertised MCP scope has an authorized working tool.
- [x] Focused regressions and bounded release gates pass with the Drizzle chain and taxonomy seed unchanged.

## TODOs

- [x] Make the refund/deletion saga and canonical webhook projection fail closed and resumable.
- [x] Enforce paid-period deadlines and protect the current billing owner in all membership mutations.
- [x] Reconcile stale trial resources and purge check-in recovery rows in scheduled maintenance.
- [x] Restart portable-import backfill and preserve authoritative deletion intent for natural-key replacements.
- [x] Harden MCP key management, paid authorization, expiry, recovered households, and recipe propagation.
- [x] Add authorized household administration, check-in read, and food-profile MCP tools.
- [x] Run one bounded final validation and prove the migrations and seed remain byte-identical.

## Notes

- Base: `57e20c5b63cc7f982b9386e83958c916c77fb996`.
- No remote D1, WorkOS, Stripe, Cloudflare, deployment, issue, or PR mutation runs here.
- Vitest and Playwright stay at four workers or fewer. Suites never overlap.
- Preserve both generated Drizzle migrations and the canonical 40-unit/184-alias seed byte-for-byte.
- Refund/deletion slice: 1 file / 4 tests passed. Pending and action-required refunds stay outside
  recovery until canonical Stripe status succeeds; failed refunds stay failed. Webhooks fetch canonical
  refund/subscription state before projection.
- Paid-boundary slice: 3 files / 20 tests passed. Active and trialing server capability now stops at
  `current_period_end`; grace uses an exclusive deadline. Other admins cannot demote or remove the current
  billing owner while billing remains live.
- Maintenance slice: 2 files / 5 tests passed. Empty one-hour reservations release safely. Cleaned
  rollback claims become consumed claims, so cleanup stops without reopening either trial allowance. Final
  household purge now removes matching check-in recovery rows. Svelte check passed with 0 errors and 0 warnings.
- Portability slice: 1 file / 8 tests passed. Import clears affected backfill checkpoints and wakes the
  matching device sync manager. Replacing an acknowledged natural-key row enqueues its deletion snapshot
  before writing the imported identity. Svelte check passed with 0 errors and 0 warnings.
- MCP boundary slice: 3 files / 41 tests passed. Create and reroll now require current paid service. Key
  storage caps eight live keys and twenty creations per rolling day. Expiry accepts canonical future UTC
  instants only. Recovered households require a new subscription identity, and recipe propagation requires
  `meals:write` in the effective household intersection.
- MCP scope slice: 4 files / 38 tests passed. Check-in reads and user food-profile reads/writes use the
  shared normalized sync repositories. Invite and member administration delegates to the existing
  WorkOS-plus-D1 service after MCP scope and effective-membership authorization.
- Final gate: D1 schema/seed check passed; lint passed; Svelte check reported 0 errors and 0 warnings;
  66 unit files / 368 tests passed; production build and 189,887 / 256,000-byte initial gzip budget
  passed; 22 Playwright tests passed with four workers. Both migrations and the taxonomy seed match
  their base-commit SHA-256 hashes byte-for-byte.
- Merge audit: fixed terminal refund retry and missed-webhook reconciliation, kept local deletion
  pending until refund success, made stale-trial cleanup restore live Stripe subscriptions and retain
  used claims, released customer-only claims, applied billing-owner deadlines, and required both MCP
  key scope and canonical WorkOS/D1 permissions. The first focused batch passed 83/84; after fixing
  its one refund fixture, both billing files passed 10/10 and the final trial file passed 5/5.
  `pnpm check` reported 0 errors and 0 warnings. Migration and seed hashes still match the base commit
  byte-for-byte.
