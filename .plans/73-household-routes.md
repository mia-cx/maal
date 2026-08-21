# #73 Implement household administration Worker routes

## Summary

Connect the existing Dexie household administration adapter to auth-slot-scoped SvelteKit Worker routes. WorkOS stays authoritative for organizations, memberships, roles, and permissions. D1 stores verified projections and hashed Maal invite codes.

## Acceptance criteria

- [ ] Every existing household administration call reaches a real retained-auth-slot route.
- [ ] Create, join, refresh, invite management, role changes, removal, and leave fail closed against live WorkOS and D1 state.
- [ ] Maal invite codes are hashed in D1 and consumption is serialized, bounded, replay-safe, and compensated.
- [ ] Successful responses update only the target household projection in Dexie.
- [ ] The approved prototype household UI uses the real refresh and leave paths without visual redesign.
- [ ] Miniflare, route, client, and browser tests cover the required success and denial cases.

## TODOs

- [x] Define versioned Effect HTTP contracts, tagged failures, and a testable WorkOS identity adapter.
- [x] Implement D1 projection, authorization, lock, invite, and compensation repositories.
- [~] Implement household administration services and auth-slot-scoped routes.
- [ ] Extend the Dexie client projection commit and reconnect prototype refresh and leave interactions.
- [ ] Add Miniflare D1, route, client, and browser coverage.
- [ ] Run focused and full validation and record the proof.

## Notes

- No D1 migration is expected. The normalized identity and lock tables already cover this slice.
- WorkOS organization names are merged into the local household projection at the HTTP boundary.
- Dexie `userAttributions` holds safe display identity for remote household members without creating switchable local profiles.
- `pnpm check` passes after the contracts and WorkOS adapter change.
