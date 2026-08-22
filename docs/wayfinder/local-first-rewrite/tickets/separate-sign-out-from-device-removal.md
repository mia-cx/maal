---
title: Separate sign-out from device removal
parent: ../map.md
label: wayfinder:decision
status: closed
assignee: mia
blocked_by: []
---

## Question

What happens to local data and retained credentials when a person signs out or removes their profile from a shared device?

## Resolution

Expose two distinct actions:

- **Sign out:** revoke and clear only that profile's remote auth slot. Keep the local profile and all locally available data usable offline, with remote features marked `reauthRequired`.
- **Remove from this device:** require explicit confirmation, explain unsynchronized work, and offer export first. Revoke the auth slot; remove the local profile, its private recipes, profile preferences, private sync cursors, and every pending mutation owned by that profile.

Household aggregates remain when another retained local profile is still a member of that household. Deleting Alice's pending outbox entries does not roll back the shared local aggregate Bob can already access. If that state still needs synchronization, Bob must explicitly edit or confirm it, creating a new authorized mutation under Bob's identity. Never rewrite the historical author of an existing record.

If no retained profile can access an affected household, its cleanup follows the separate membership-removal and detached-data policy.
