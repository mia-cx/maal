---
title: Order synchronized changes at D1
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee: mia
blocked_by: []
---

## Question

What determines the winner when paid devices submit conflicting local changes?

## Resolution

For routine live synchronization, the committed `sync_changes.seq` orders accepted changes. Server receipt time is descriptive. Latest-wins applies within named mutation groups, not across an entire aggregate. A delayed stale live mutation may win if D1 accepts it later; that consequence is accepted for v1.

Bootstrap and historical backfill are different. Each local domain event records `occurredAt`, the client-observed UTC instant when the actual edit happened; batching or sending later never changes it. Aggregate snapshots carry the latest event time for each named conflict group.

When a backfilled contender and the stored winner have event times more than one hour apart, the later `occurredAt` wins regardless of upload order. This prevents an edit made a month earlier but uploaded later from overwriting a newer edit. When their event times are within one hour, treat the difference as possible clock skew and resolve by D1 commit order, with `(originDeviceId, mutationId)` as the deterministic idempotency tie-break. D1 assigns a committed sequence to every accepted backfill winner. Routine live synchronization always resolves by committed D1 sequence.

All stored instants and wire timestamps use UTC. Household timezones are presentation and scheduling context only; they never participate in reconciliation.

Mutation IDs provide idempotency. Routine sync transmits typed mutations. Bootstrap, backfill, and recovery transmit complete aggregate snapshots.
