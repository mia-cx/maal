# #78 Bind PWA coordinator runtime timers safely

## Summary

Keep browser timer methods attached to their global receiver and make the PWA coordinator safe to start,
stop, and restart without duplicate listeners or work.

## Acceptance criteria

- [x] Timer methods use receiver-safe runtime wrappers.
- [x] Repeated and overlapping lifecycle calls do not duplicate timers, channels, or listeners.
- [x] Update prepare, drain, ACK, activation, and reload behavior stays unchanged.
- [x] First install stays silent and recovery-route startup is safe.
- [x] Focused unit and Chromium, Firefox, and WebKit startup regressions pass where available.

## TODOs

- [x] Add focused failing regressions for receiver-sensitive timers and coordinator lifecycle behavior.
- [x] Implement receiver-safe timers and idempotent coordinator lifecycle cleanup.
- [x] Extend the real PWA startup browser proof and run the available browser matrix.
- [x] Run final focused validation and record exact results.

## Notes

- Base integration commit: `eb922e591130519253c64caf2af23af4f8fb3949`.
- Preserve the prototype UI and the existing cross-tab update protocol.
- The serialized full `pnpm validate` gate belongs to the integration test slot and is not run concurrently.
- `pnpm exec vitest run tests/unit/pwa-update-coordinator.spec.ts --reporter=verbose` passes 3 tests.
- `pnpm exec svelte-check --tsconfig ./tsconfig.json` reports 0 errors and 0 warnings.
- Chromium passes 2 focused PWA tests. Firefox passes the same 2 tests.
- WebKit is installed but cannot launch on this host because its GTK, AVIF, Manette, Enchant, Secret,
  and WOFF2 runtime libraries are absent.
- Final `pnpm validate` passes formatting, ESLint, a 0-error/0-warning Svelte check, 48 unit files / 269
  tests, the production build, the 178,401 / 256,000-byte gzip budget, and 13 Chromium E2E tests.
