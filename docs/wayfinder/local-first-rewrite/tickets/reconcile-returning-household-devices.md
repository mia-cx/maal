---
title: Reconcile returning household devices
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee: mia
blocked_by: []
---

## Question

How do household members converge after a paid plan lapses while each keeps editing locally?

## Resolution

After entitlement and membership refresh, each returning device pulls or rebootstraps retained D1 state, reapplies its pending typed mutations locally, pushes them, then pulls through the last accepted sequence. Other members follow the same process as they reconnect.

Current mutations outrank historical backfill. Backfill uploads current older recipes, meals, and check-ins in slow, resumable, idempotent batches. It does not replay edit history that Maal never retained.
