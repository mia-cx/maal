---
title: Detach revoked household snapshots
parent: ../map.md
label: wayfinder:decision
status: closed
assignee: mia
blocked_by: []
---

## Question

What happens when a device reconnects after its local profile was removed from a formerly synchronized household?

## Resolution

An authoritative membership denial immediately disables push and pull for that profile-household pair and quarantines its pending outbox entries. The last local household snapshot remains available as a read-only, local-only detached snapshot. It receives no future remote changes and can never upload under the former household ID.

The person can export the detached snapshot or explicitly fork its eligible current records into a new local household. Forking creates new aggregate IDs and new mutations; it never replays the former household's outbox or claims that old records were authored by the person doing the fork. User-owned recipes remain user-owned and do not need to be forked merely because household membership ended.

The product does not promise remote erasure of already downloaded local-first data. It does prevent all future access and synchronization after membership revocation.
