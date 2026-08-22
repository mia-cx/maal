# #79 Complete local release automation and PWA proofs

## Summary

Complete the locally executable release gates for the local-first rewrite. CI must apply the full D1
migration chain. Chromium must prove safe two-tab PWA activation, atomic quota failure with recovery
export, and routine free content use without Worker or D1 requests.

## Acceptance criteria

- [ ] CI runs `pnpm validate` and the complete local D1 migration-chain proof.
- [ ] Two real tabs prepare, drain, acknowledge, activate, and reload without losing a local commit.
- [ ] A real browser quota abort leaves both the aggregate and outbox unchanged.
- [ ] Recovery export remains usable after the quota abort.
- [ ] Routine free recipe and meal use makes no Worker/D1 content requests.
- [ ] Focused and final serialized release validation passes.

## TODOs

- [x] Add the D1 migration-chain command to CI and prove the CI command boundary.
- [x] Prove the two-tab service-worker update protocol through real browser pages and a real worker.
- [x] Prove quota-abort atomicity and recovery export through the browser UI.
- [ ] Record a final free-use content trace that distinguishes Worker/D1 routes from shell assets.
- [ ] Run the focused gates, then run the full gate only after the integration test slot is granted.

## Notes

- Base integration commit: `833843751463b8fcc02e911297cd1ec265895d31`.
- Confirmed seams: the CI command boundary and the page/service-worker browser contract.
- Preserve the approved prototype UI and the existing PWA coordinator protocol.
- Current Cloudflare D1 guidance applies migration files in sequential order and records them in the
  configured migrations table. The existing `pnpm test:d1-schema` command exercises that chain locally.
- The two-tab Chromium proof records the public BroadcastChannel phases in order, confirms both tabs move
  to the waiting worker, and reloads the recipe commit from Dexie. No coordinator runtime change was needed.
- The quota proof injects a native `QuotaExceededError` at Chromium's IndexedDB boundary after the aggregate
  write begins. Dexie keeps the recipe and outbox counts unchanged when the browser aborts the transaction.
