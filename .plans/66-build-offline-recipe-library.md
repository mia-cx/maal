# #66 Build offline recipe library and recovery

## Summary

Port the approved prototype recipe library and editor unchanged at the interaction layer, while replacing its HTTP/store seams with a lossless Effect-decoded recipe aggregate in the shared Dexie database.

## Acceptance criteria

- [ ] Recipe headers and all seven sidecar families preserve every implemented prototype field.
- [ ] Create, edit, search, delete, restore, and permanent delete work offline through commands and live queries.
- [ ] Deleted content remains recoverable for 30 days and minimal purge tombstones remain for one year.
- [ ] Imported candidates retain provenance and URL media, and only become recipes through the normal local command after confirmation.
- [ ] Existing meals are not removed when a source recipe is permanently deleted.
- [ ] The approved prototype recipe UI is ported without redesign.

## TODOs

- [x] Define the complete recipe aggregate contract, lossless editor patch, local commands, queries, and retention behavior.
- [x] Port the prototype recipe UI and interaction helpers without changing its visual or keyboard behavior.
- [x] Wire the menu route to Dexie and add offline, recovery, import-fidelity, and hidden-sidecar tests.
- [~] Run focused and full validations and record any residual caveats.

## Notes

- Remote URL fetching and synchronization are owned by #64 and #61; this slice accepts an already-decoded imported candidate.
- Recipe view models are projections only and are never written back as complete aggregates.
- Domain/local validation: `pnpm test:unit -- tests/unit/recipes.spec.ts` (56 tests passed across 8 files) and `pnpm check` (0 diagnostics).
- Prototype UI/helper validation: `pnpm test:unit -- src/lib/menu src/lib/recipes` (84 tests passed across 14 files) and `pnpm check` (0 diagnostics).
- Surface validation: browser component tests cover editor/recovery copy; the real `/menu` route creates while offline, reloads from IndexedDB, and issues zero `/api/` content requests.
