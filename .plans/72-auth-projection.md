# #72 Project retained auth callbacks into local profiles

## Summary

Consume the retained-session callback marker once, fetch its safe server projection, and commit the matching profile and auth slot to the shared Dexie database.

## Acceptance criteria

- [x] Callback query state is removed before the metadata request and cannot replay on reload.
- [x] Safe metadata is decoded and profiles, auth slots, attribution, selection, and lock state change in one Dexie transaction.
- [x] Add-profile and reauthentication preserve unrelated local profiles, sessions, households, and content.
- [x] Stale, revoked, and failed sessions keep local data usable with a targeted reauthentication state.
- [x] Tests cover the real route contract, browser handoff, URL cleanup, idempotency, and cookie independence.

## TODOs

- [x] Add the safe metadata wire contract and make the selected-slot route emit it.
- [x] Add the one-shot browser callback consumer and atomic Dexie projector.
- [x] Mount the projector without changing the approved UI, and expose focused stale-session copy.
- [x] Add unit, route, browser, and E2E regressions for add-profile, reauthentication, replay, failure, and retained slots.
- [x] Run focused checks and the full validation suite.

## Notes

- Prototype UI authority remains `main` at `74a12ec38f6c297d1a6adbf596234c45212bac11`.
- Callback parameters contain only the opaque slot ID and status. Credentials remain in path-scoped HTTP-only cookies.
- The selected-slot endpoint must remain slash-terminated. Its retained cookie does not match the slashless redirect target.
- Focused integration validation: 28 server tests, 1 browser test, 3 Playwright tests, and `git diff --check` passed.
- Full integration validation: lint, Svelte check (0 errors and warnings), 260 Vitest tests across 46 files, production build, 178,043 / 256,000-byte initial gzip budget, and 11 Playwright tests passed.
- `pnpm test:d1-schema` passed. Integration also adds an in-transaction capacity guard and proves both ninth-slot rejection and full-store rollback.
