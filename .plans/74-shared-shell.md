# #74 Restore the shared product shell and settings routes

## Summary

Restore the prototype product shell around the local-first routes. Reconnect profile, account, billing, and MCP settings to the Dexie and Worker adapters that now own those boundaries.

## Acceptance criteria

- [ ] Plan, menu, household, settings, and subscribe use one shared sidebar provider.
- [ ] Root enters the local meal plan without a placeholder page.
- [ ] The prototype navigation, sidebar resize behavior, profile switcher, and route feedback remain intact.
- [ ] Settings exposes account/session state, local profile controls, billing, and exact MCP key grants.
- [ ] MCP key secrets appear once and are never persisted locally.
- [ ] Routine navigation and free content use make no content Worker or D1 requests.
- [ ] Desktop, tablet, phone, keyboard, accessibility, and visual checks pass.

## TODOs

- [x] Restore the shared app shell and remove route-owned sidebar providers.
- [~] Add the local-first settings routes and MCP key client adapter.
- [ ] Add the local-first subscribe route on the approved billing UI.
- [ ] Add route, unit, browser, zero-network, and visual regression proof.
- [ ] Run focused validation and the full validation suite.

## Notes

- Prototype authority: `main@74a12ec38f6c297d1a6adbf596234c45212bac11`.
- `/recovery` remains outside `(app)` so database-open failure can still reach it.
- Groceries, pantry, integrations, anonymous profiles, passkeys, and owned-image ingest stay excluded.
