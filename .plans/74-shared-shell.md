# #74 Restore the shared product shell and settings routes

## Summary

Restore the prototype product shell around the local-first routes. Reconnect profile, account, billing, and MCP settings to the Dexie and Worker adapters that now own those boundaries.

## Acceptance criteria

- [x] Plan, menu, household, settings, and subscribe use one shared sidebar provider.
- [x] Root enters the local meal plan without a placeholder page.
- [x] The prototype navigation, sidebar resize behavior, profile switcher, and route feedback remain intact.
- [x] Settings exposes account/session state, local profile controls, billing, and exact MCP key grants.
- [x] MCP key secrets appear once and are never persisted locally.
- [x] Routine navigation and free content use make no content Worker or D1 requests.
- [x] Desktop, tablet, phone, keyboard, accessibility, and visual checks pass.

## TODOs

- [x] Restore the shared app shell and remove route-owned sidebar providers.
- [x] Add the local-first settings routes and MCP key client adapter.
- [x] Add the local-first subscribe route on the approved billing UI.
- [x] Add route, unit, browser, zero-network, and visual regression proof.
- [x] Run focused validation and the full validation suite.

## Notes

- Prototype authority: `main@74a12ec38f6c297d1a6adbf596234c45212bac11`.
- `/recovery` remains outside `(app)` so database-open failure can still reach it.
- Groceries, pantry, integrations, anonymous profiles, passkeys, and owned-image ingest stay excluded.
- Focused MCP tests pass: 2 files, 6 tests. Focused browser proof passes: 3 tests with
  inspected desktop and phone snapshots.
- `pnpm validate` passes: formatting/lint, 0 check diagnostics, 48 unit files and 266 tests,
  production build, 180,006 / 256,000 initial-entry gzip bytes, and 14 browser tests.
