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
- [~] Implement versioned ZIP schemas, visibility selection, guarded decode, collision planning, remapping, and atomic commit.
- [ ] Wire prototype-styled archive, update, and recovery controls into existing application seams.
- [ ] Add the shell-only service worker, install assets, safe update protocol, and offline boot behavior.
- [ ] Prove round trips, rejection/rollback, remaps, recovery, update gating, offline reopen, and zero free content traffic.

## Notes

- Prototype authority: `74a12ec38f6c297d1a6adbf596234c45212bac11`.
- The service worker never reads IndexedDB and never handles domain APIs.
- Imported user display rows go to `userAttributions`; imports never create synthetic profiles.
- `pnpm vitest run tests/unit/local-runtime.spec.ts` passes 12 tests. `svelte-check` is clean.
