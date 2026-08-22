# #84 Align deployment resource names with existing Maal environments

## Summary

Point the rewrite at Maal's existing long-lived Cloudflare Workers and D1 databases. Keep schema changes in the
current forward-only D1 migration chain instead of creating versioned replacement resources.

## Acceptance criteria

- [ ] Local, staging, and production D1 names are `maal-local`, `maal-staging`, and `maal-prod`.
- [ ] Local, staging, and production Worker names are `maal-local`, `maal-staging`, and `maal`.
- [ ] Tracked Wrangler config retains the existing staging and production D1 IDs.
- [ ] Migration scripts and guarded staging preflight use the same resource names.
- [ ] Architecture notes and the cutover runbook require in-place schema migrations for future app versions.
- [ ] No remote resource is created, deployed, migrated, or otherwise changed.
- [ ] Focused staging contracts, the local D1 chain, and `pnpm validate` pass.

## Test seams

- The tracked Wrangler configuration is the deployment resource contract for every environment.
- Package migration commands and the local D1 proof are the operator-facing migration interfaces.
- `validateLiveEnvironment` is the guarded staging preflight interface.
- The runbook is the operator-facing cutover procedure.

## TODOs

- [ ] Add failing resource-name contracts, then restore existing Worker and D1 bindings in Wrangler config.
- [ ] Add failing migration/preflight contracts, then align scripts and guarded staging validation.
- [ ] Rewrite architecture and cutover guidance around inspecting and migrating long-lived D1 databases in place.
- [ ] Run focused staging contracts, the D1 migration chain, and full validation.

## Notes

- Historical config authority: `e44fa967:wrangler.jsonc`.
- Production uses Worker `maal` with D1 `maal-prod`; there is no `maal-prod` Worker.
- The shared browser Dexie database remains `maal-v1:<environment>`. This issue changes Cloudflare resource
  names, not the IndexedDB schema namespace.
- Remote operations are out of scope for this branch.
