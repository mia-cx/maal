# #59 Build offline profiles and household administration

## Summary

Implement the device-local profile lifecycle and household administration domain seams on the shared Dexie database. Preserve the prototype household UI once the separately-owned UI baseline lands.

## Acceptance criteria

- [x] Up to eight real profiles switch locally without changing retained WorkOS sessions.
- [x] PIN locks, stale/reauth states, sign-out, and removal from device have distinct behavior.
- [x] Household visibility and write authorization use cached WorkOS membership permissions.
- [x] Household settings and appliances commit locally and enqueue mutations without making a request.
- [x] Invite and membership administration are explicit remote commands whose decoded projections are committed before observation; raw invite codes never enter Dexie.
- [x] Revoked membership quarantines the affected outbox and preserves an exportable, forkable detached snapshot.
- [x] The preserved prototype household shell exposes the new profile and lifecycle flows without conflating household and profile switching.

## TODOs

- [x] Define exact profile, membership, household, appliance, invite, and UI-state contracts.
- [x] Implement local profile switching, PIN verification, sign-out projection, and device removal.
- [x] Implement cached authorization, local household settings/appliance commands, and profile-scoped household queries.
- [x] Implement explicit invite/member remote adapters and safe projection commits.
- [x] Implement membership-loss detachment and local snapshot forking.
- [x] Adapt the preserved prototype household/profile UI after the shared baseline lands.
- [x] Add unit and composed-browser coverage for the full slice.

## Notes

- Shared UI source is owned by a separate baseline ticket; this branch must not duplicate it.
- WorkOS organizations remain authoritative for real remote households. A forked detached snapshot is local-only until explicitly attached to a new organization.
- The merged shared baseline preserves the prototype scroll SDK, calendar/range-calendar UI, primitives, assets, and design tokens verbatim; this slice only adapts household/profile product state to Dexie.
- Household creation, joining, invites, and membership changes are deliberate remote ceremonies. Routine settings, appliances, switching, PINs, and household reads remain local-only.
