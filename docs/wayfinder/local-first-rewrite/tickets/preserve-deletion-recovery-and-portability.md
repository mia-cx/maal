---
title: Preserve deletion recovery and portability
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee: mia
blocked_by: []
---

## Question

How do deletion, recovery, and data freedom work in a local-first application?

## Resolution

Deleted recipes retain their complete content in a user-visible recovery section for 30 days unless restored or explicitly erased sooner. Permanent deletion removes recipe content immediately. Meals have no recovery window. Minimal recipe and meal sync tombstones remain for one year.

A client cursor older than the retained change-log or tombstone floor must perform full snapshot reconciliation. A local record that was previously acknowledged by the server but is absent from the authoritative snapshot is treated as deleted and cannot be uploaded as a new record. This prevents resurrection after its tombstone has expired while preserving genuinely local-only records that have never received a server acknowledgement.

Every user can import and export portable files without a subscription. V1 uses WorkOS and D1 for hosted identity and synchronization, but the data contract must not prevent a future user-provided remote store.
