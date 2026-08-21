# #68 Implement portable archives and PWA safety

## Summary

Add portable, user-visible domain archives and a shell-only PWA. Keep every domain read and write in Dexie.

## Acceptance criteria

- [ ] Export includes all visible portable data and excludes local auth, billing, sync, and UI state.
- [ ] Import validates first, reports ID and natural-key collisions, remaps declared references, and commits atomically.
- [ ] Failed database upgrades retain a recovery-only inspection and export path.
- [ ] Updates drain local commits across live tabs before activating a waiting service worker.
- [ ] The production shell reopens offline without auth, billing, sync, or content API requests.

## TODOs

- [x] Add the attribution store, recovery-safe database opening, migration events, and shared commit gate.
- [x] Implement versioned ZIP schemas, visibility selection, guarded decode, collision planning, remapping, and atomic commit.
- [x] Wire prototype-styled archive, update, and recovery controls into existing application seams.
- [x] Add the shell-only service worker, install assets, safe update protocol, and offline boot behavior.
- [x] Prove round trips, rejection/rollback, remaps, recovery, update gating, offline reopen, and zero free content traffic.

## Notes

- Prototype authority: `74a12ec38f6c297d1a6adbf596234c45212bac11`.
- The service worker never reads IndexedDB and never handles domain APIs.
- Imported user display rows go to `userAttributions`; imports never create synthetic profiles.
- `pnpm vitest run tests/unit/local-runtime.spec.ts` passes 12 tests. `svelte-check` is clean.
- `pnpm vitest run tests/unit/portability.spec.ts` passes 4 archive/remap/rollback tests.
- `pnpm vitest run tests/unit/local-runtime.spec.ts tests/unit/portability.spec.ts tests/unit/pwa-messages.spec.ts` passes 19 tests.
- `pnpm vitest run tests/unit/pwa-update-coordinator.spec.ts tests/unit/pwa-messages.spec.ts tests/unit/local-runtime.spec.ts` passes 16 tests, including a held second-tab drain.
- `pnpm exec playwright test tests/e2e/pwa-offline.e2e.ts --reporter=line` passes offline reopen with zero content API traffic.
- Production build succeeds and `svelte-check` reports zero errors or warnings.
- Final validation passes lint, 0-error `svelte-check`, 32 unit files / 153 tests, production build, and the 127,717 / 256,000-byte gzip budget. The final full browser gate passes 8 / 8 tests.
- Browser proof caught two first-install hazards before handoff: an unconditional `controllerchange` reload and an initial-install update prompt. Both now occur only for a coordinated replacement worker.
