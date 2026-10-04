# #73 Implement household administration Worker routes

## Summary

Connect the existing Dexie household administration adapter to auth-slot-scoped SvelteKit Worker routes. WorkOS stays authoritative for organizations, memberships, roles, and permissions. D1 stores verified projections and hashed Maal invite codes.

## Acceptance criteria

- [x] Every existing household administration call reaches a real retained-auth-slot route.
- [x] Create, join, refresh, invite management, role changes, removal, and leave fail closed against live WorkOS and D1 state.
- [x] Maal invite codes are hashed in D1 and consumption is serialized, bounded, replay-safe, and compensated.
- [x] Successful responses update only the target household projection in Dexie.
- [x] The approved prototype household UI uses the real leave path without visual redesign, while remote refresh stays an explicit client operation.
- [x] Miniflare, route, client, and browser tests cover the required success and denial cases.

## TODOs

- [x] Define versioned Effect HTTP contracts, tagged failures, and a testable WorkOS identity adapter.
- [x] Implement D1 projection, authorization, lock, invite, and compensation repositories.
- [x] Implement household administration services and auth-slot-scoped routes.
- [x] Extend the Dexie client projection commit and reconnect prototype refresh and leave interactions.
- [x] Add Miniflare D1, route, client, and browser coverage.
- [x] Run focused and full validation and record the proof.

## Notes

- No D1 migration is expected. The normalized identity and lock tables already cover this slice.
- WorkOS organization names are merged into the local household projection at the HTTP boundary.
- Dexie `userAttributions` holds safe display identity for remote household members without creating switchable local profiles.
- `pnpm check` passes after the contracts and WorkOS adapter change.
- `pnpm vitest run tests/unit/household-administration-client.spec.ts tests/unit/household-administration-d1.spec.ts tests/unit/profiles-households.spec.ts` passes 15 tests.
- `pnpm playwright test tests/e2e/profiles-households.e2e.ts` passes all 3 browser tests, including the retained-auth-slot leave flow and the zero-routine-API-request profile flow.
- Household refresh remains explicit instead of running on component mount, preserving the zero-request local/free path.
- `pnpm validate` passes: formatting/lint, zero Svelte diagnostics, 197 unit tests, production build and performance budget, and 9 browser tests.
- `pnpm test:d1-schema` passes against the full migration chain.
