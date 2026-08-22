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
- [ ] Bound salvage reads and cover them with focused unit tests.
- [ ] Refine the existing recovery screen around export-first and explicit reset behavior.
- [ ] Add the failed-schema browser proof and run focused validation.

## Notes

- Recovery keeps the existing Maal product tokens and component system.
- The export remains JSON so a damaged database never enters the normal archive pipeline.
- Full `pnpm validate` waits for the serialized integration slot.
- `pnpm check` passes after the startup gate.
