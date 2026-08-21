---
title: Specify the device Dexie schema
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee:
blocked_by:
  - Specify exact Effect and D1 contracts
  - Prove retained AuthKit slots
---

## Question

What exact stores, records, indexes, ownership fields, transaction boundaries, projections, migrations, and live-query interfaces support several real profiles and shared free households in one device database?

## Settled migration policy

V1 schema migrations are forward-only and non-destructive. Deprecated stores and fields remain readable until a later major migration explicitly retires them. A Dexie `versionchange` closes old connections and prompts affected tabs to reload. Production rollback means shipping a forward-compatible fix that understands the newest released database schema; older application code must never reopen a newer database destructively.

Commands use the last locally verified WorkOS membership and permission projection while offline. A remote membership denial quarantines pending work and detaches the last household snapshot. IndexedDB quota failures abort the complete command transaction and never evict domain data. Decode or migration failure opens a recovery shell, attempts export of every decodable record, and requires explicit confirmation before clearing local storage.

## Resolution

Specified in `docs/architecture/local-first-rewrite-spec.md` §6. The stale per-user database design is explicitly superseded by one logically scoped shared device database.
