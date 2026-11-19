# Maal

Maal is a local-first meal-planning application. Local use is complete without a paid household subscription; a subscription adds remote synchronization and collaboration.

## Product UI authority

The in-scope UI at `main` commit `74a12ec38f6c297d1a6adbf596234c45212bac11` is already approved. The local-first rewrite preserves its routes, components, design tokens, copy, accessibility, and interactions—including the custom scroll SDK and complete calendar/schedule experience—and replaces only its data seams unless a later product decision explicitly changes it.

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

**Recipe version**:
An immutable record of a recipe's content at one change, stamped with when the owner made that change. A deletion leaves a version with no content.
_Avoid_: Revision (that is the sync counter), recipe snapshot

**Recipe-following meal**:
A planned meal that stores no recipe content and shows one version of its recipe: the version its check-in pinned, otherwise the version in effect when its date ends, which is the latest one for a future meal. Its first content edit makes it a meal copy.
_Avoid_: Linked meal, live meal, reference meal

**Pinned version**:
The recipe version a check-in records as the one cooked. The meal shows it from then on.
_Avoid_: Frozen meal

**Meal copy**:
A meal that holds its own copy of the recipe content and never changes with the recipe. Custom meals are meal copies from the start.
_Avoid_: Snapshot, detached meal

**Shared recipe version**:
A version of another member's recipe that a household receives read-only because one of its recipe-following meals follows that recipe. A household follows only its current members' recipes: when a member leaves, its meals of their recipes become meal copies.
_Avoid_: Household recipe, shared recipe

**Staleness threshold**:
How long an edit may wait on a device and still count as current. A household sets its own; personal records use 3 hours. An edit younger than the threshold brings back a record someone deleted.
_Avoid_: Grace period, late-upload window

**Reinstated record**:
A deleted recipe or meal that a recent edit brought back. It returns like a record another member just created, with a Reinstated badge until opened.
_Avoid_: Restored record (that is a recipe brought back from the bin)

**Portable archive**:
A file through which a person can export and later restore their locally available Maal data without remote synchronization.
_Avoid_: Cloud backup, database dump
