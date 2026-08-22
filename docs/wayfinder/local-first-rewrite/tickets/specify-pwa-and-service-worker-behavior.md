---
title: Specify PWA and service-worker behavior
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee:
blocked_by:
  - Specify the device Dexie schema
  - Specify the sync protocol
---

## Question

What caching, installation, activation, update, offline-reopen, optional background-sync, and rollback rules keep the shared local database safe across releases?

## Settled update policy

Download new application assets in the background, then prompt for reload. Do not activate an update while a command or Dexie transaction is in flight. Coordinate all open tabs before activation and reload them onto one application version. A critical update may force reload only after every local write has committed to Dexie. Service-worker rollback must follow the forward-compatible Dexie migration policy rather than attempting to downgrade IndexedDB.

## Resolution

Specified in `docs/architecture/local-first-rewrite-spec.md` §10.
