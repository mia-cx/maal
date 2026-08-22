---
title: Specify the Maal local-first rewrite
label: wayfinder:map
status: closed
---

## Destination

Produce a decision-complete, field-complete architecture and schema specification for rebuilding the working Maal application as a local-first PWA. The specification must be sufficient to drive a separate implementation Wayfinder without reopening product or persistence fundamentals.

## Notes

- Preserve the implemented prototype's behavior and technically sound data model unless a linked decision explicitly changes it.
- The stack is locked: SvelteKit, Effect Schema, Dexie/IndexedDB, Cloudflare Worker and D1/Drizzle, WorkOS, Stripe, MCP, Vitest, and Playwright.
- The authenticated UI observes Dexie only. Paid remote services are optional additions to a complete local application.
- Use `domain-modeling` while resolving vocabulary and hard domain boundaries. Use `grilling` for human decisions and `research` for external facts.
- This effort carries specification writing through the map instead of stopping at decision discovery.
- Local Markdown tracker convention: each ticket is a child file under `tickets/`; `status`, `label`, `assignee`, and `blocked_by` frontmatter represent tracker state and dependencies.

## Decisions so far

- [Make Dexie the UI authority](tickets/make-dexie-the-ui-authority.md): local commands and live queries define the application; remote responses become visible only through Dexie.
- [Sell one complete Maal plan](tickets/sell-one-complete-maal-plan.md): one household subscription enables every server-backed feature while all cleanly local features remain free.
- [Limit trials by user and household](tickets/limit-trials-by-user-and-household.md): a trial consumes both a unique user allowance and a unique household allowance.
- [Order synchronized changes at D1](tickets/order-synchronized-changes-at-d1.md): committed D1 sequence decides live latest-wins; original UTC edit time prevents stale historical backfill from overwriting much newer work.
- [Reconcile returning household devices](tickets/reconcile-returning-household-devices.md): pull, reapply pending local intent, push, and pull to convergence after a lapse.
- [Preserve deletion recovery and portability](tickets/preserve-deletion-recovery-and-portability.md): recipes support recovery and explicit permanent deletion; every user can use file import/export.
- [Use the prototype domain model as baseline](tickets/use-the-prototype-domain-model-as-baseline.md): preserve implemented fields, invariants, and behavior unless explicitly changed.
- [Keep the proven taxonomy model](tickets/keep-the-proven-taxonomy-model.md): retain normalized D1 taxonomy and expose a lossless editable Dexie projection.
- [Share free household state on one device](tickets/share-free-household-state-on-one-device.md): one device database supports several real local profiles and shared household data.
- [Retain one real session per local profile](tickets/retain-one-real-session-per-local-profile.md): prefer path-scoped HTTP-only auth slots; local data survives remote session expiry.
- [Prove retained WorkOS auth slots](tickets/prove-retained-auth-slots.md): test Hosted AuthKit for independent retained users, then fall back to a Maal-hosted UI using documented WorkOS authentication APIs if necessary.
- [Separate sign-out from device removal](tickets/separate-sign-out-from-device-removal.md): signing out preserves the offline profile; explicit removal deletes private device data while retaining household state still available to another local member.
- [Detach revoked household snapshots](tickets/detach-revoked-household-snapshots.md): membership revocation stops sync and leaves a read-only local snapshot that can be exported or explicitly forked.
- [Retain custom D1 invite codes](tickets/retain-custom-d1-invite-codes.md): explicit household administration may use D1 for free households; routine local content use may not.
- [Defer owned recipe media](tickets/defer-owned-recipe-media.md): v1 preserves image URLs and provenance without ingesting bytes or depending on R2.
- [Delete households after refund and recovery](tickets/delete-households-after-refund-and-recovery.md): cancel and cash-refund unused paid time before a 30-day recoverable deletion, then purge remote household content.

## Output

The destination is complete in [`../../architecture/local-first-rewrite-spec.md`](../../architecture/local-first-rewrite-spec.md). It is the canonical architecture, field-complete schema, protocol, safety policy, and implementation frontier.

The remaining open proof tickets validate WorkOS browser/session and entitlement behavior during implementation. Both have specified fallbacks and do not reopen the architecture.

## Out of scope

- Grocery lists and pantry inventory.
- Grocery-store, OAuth, and other future remote integrations beyond leaving capability room for them.
- Anonymous profiles.
- Passkeys and Maal-owned WebAuthn authentication.
- Bring-your-own remote storage or alternate identity providers in v1.
- Prototype D1 or IndexedDB data migration.
- Marketing-page design.
