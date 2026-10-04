# #77 Make the recovery route survive database open failures

## Summary

Keep the recovery route outside normal Dexie, sync, auth callback, and PWA startup. Redirect failed normal startup into that route, then export decodable data through bounded read-only batches.

## Acceptance criteria

- [ ] Recovery skips normal database open, sync, and application helpers.
- [ ] Failed startup renders the recovery-safe shell.
- [ ] Recovery export reads safe stores in bounded batches without writes.
- [ ] Normal routes cannot continue while recovery is required.
- [ ] Browser proof injects an incompatible schema and downloads a safe artifact.

## TODOs

- [x] Gate client startup and root application helpers around recovery.
- [x] Bound salvage reads and cover them with focused unit tests.
- [x] Refine the existing recovery screen around export-first and explicit reset behavior.
- [x] Add the failed-schema browser proof and run focused validation.

## Notes

- Recovery keeps the existing Maal product tokens and component system.
- The export remains JSON so a damaged database never enters the normal archive pipeline.
- Full `pnpm validate` waits for the serialized integration slot.
- `pnpm check` passes after the startup gate.
- `pnpm exec vitest run tests/unit/local-runtime.spec.ts` passes 13 tests, including one-row recovery batches.
- `pnpm check` passes after the recovery screen refinement.
- Normal startup preflights the native IndexedDB version. It never lets Dexie extend a newer committed schema.
- `pnpm exec vitest run tests/unit/local-runtime.spec.ts` passes 14 tests.
- `pnpm exec playwright test tests/e2e/recovery-startup.e2e.ts` passes 2 browser proofs.
- Focused Prettier, ESLint, and `pnpm check` pass.
- Merger audit added a literal `IDBFactory.open()` upgrade failure proof. A local recovery latch now keeps normal routes closed until explicit retry or reset.
- The focused recovery browser file passes both the newer-schema and failed-upgrade proofs.
