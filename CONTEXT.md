# Maal

Maal is a local-first meal-planning application. Local use is complete without a paid household subscription; a subscription adds remote synchronization and collaboration.

## Language

**Local profile**:
A device-resident workspace belonging to one previously authenticated person. Local profiles remain usable without a current network connection or subscription.
_Avoid_: Account, local account

**Household**:
A group that shares planned meals, check-ins, preferences, and optional remote collaboration.
_Avoid_: Organization, workspace

**Sync entitlement**:
A household's paid permission to synchronize its eligible data remotely. The application may retain a local projection of this permission, but the remote service remains authoritative.
_Avoid_: Subscription state, cloud mode

**Maal plan**:
The single paid household subscription that enables all remote Maal services for every current household member.
_Avoid_: Tier, add-on, sync plan

**Trial claim**:
A one-time pairing between a person and a household that activates a Maal plan trial. Each person may appear in at most one claim, and each household may appear in at most one claim.
_Avoid_: Household trial allowance, free plan

**Local snapshot**:
The current set of sync-eligible records in a local profile when remote synchronization begins for the first time.
_Avoid_: Backup, database dump

**Backfill**:
The gradual first upload of a local snapshot after sync entitlement becomes active.
_Avoid_: Migration, history replay

**Deleted recipe**:
A user-owned recipe hidden from normal use but retained for later restoration.
_Avoid_: Archived recipe, permanently deleted recipe

**Permanently deleted recipe**:
A recipe whose content the owner erased. A minimal deletion marker may remain temporarily to prevent another device from restoring stale content.
_Avoid_: Deleted recipe

**Portable archive**:
A file through which a person can export and later restore their locally available Maal data without remote synchronization.
_Avoid_: Cloud backup, database dump
