---
title: Specify the sync protocol
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee:
blocked_by:
  - Specify exact Effect and D1 contracts
  - Prove the Maal entitlement bridge
  - Prove retained AuthKit slots
---

## Question

What exact mutation groups, receipts, push/pull/bootstrap envelopes, cursors, backfill checkpoints, retries, audience authorization, leases, tombstone retention, and reset behavior implement the settled reconciliation model?

## Settled constraints

- Current interactive outbox entries sync without the historical throttle.
- Historical snapshots upload only while the app is online and foregrounded, at most once per 30 seconds.
- A historical batch contains at most 25 aggregates and at most 256 KiB of encoded payload. Hitting either limit closes the batch.
- Pause background backfill when the browser reports `Save-Data`; manual sync may override the pause.
- Prioritize upcoming and recent meals plus their referenced recipes, then work backward through older current records.
- Persist the checkpoint after every acknowledged batch so interruption never restarts completed work.
- Original UTC domain-event occurrence times decide bootstrap/backfill reconciliation when contenders are more than one hour apart; D1 sequence resolves closer backfill contenders and all routine live conflicts, as specified in `order-synchronized-changes-at-d1.md`.
- Recipe and meal headers and each complete sidecar collection are named conflict groups. Stable child IDs preserve references and deterministic collection replacement, but individual sidecar rows are not independently synchronized aggregates.
- Retain ordinary change rows for 90 days and minimal tombstones for one year. A cursor older than the retained floor receives `bootstrap_required` and must reconcile an authoritative snapshot.

## Resolution

Specified in `docs/architecture/local-first-rewrite-spec.md` §§7.5 and 8.
