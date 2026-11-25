# #84 Align deployment resource names with existing Maal environments

## Summary

Point the rewrite at Maal's existing long-lived Cloudflare Workers and D1 databases. Keep schema changes in the
current forward-only D1 migration chain instead of creating versioned replacement resources.

## Acceptance criteria

- [x] Local, staging, and production D1 names are `maal-local`, `maal-staging`, and `maal-prod`.
- [x] Local, staging, and production Worker names are `maal-local`, `maal-staging`, and `maal`.
- [x] Tracked Wrangler config retains the existing staging and production D1 IDs.
- [x] Migration scripts and guarded staging preflight use the same resource names.
- [x] Architecture notes and the cutover runbook require in-place schema migrations for future app versions.
- [x] No remote resource is created, deployed, migrated, or otherwise changed.
- [x] Focused staging contracts, the local D1 chain, and `pnpm validate` pass.

## Test seams

- The tracked Wrangler configuration is the deployment resource contract for every environment.
- Package migration commands and the local D1 proof are the operator-facing migration interfaces.
- `validateLiveEnvironment` is the guarded staging preflight interface.
- The runbook is the operator-facing cutover procedure.

## TODOs

- [x] Add failing resource-name contracts, then restore existing Worker and D1 bindings in Wrangler config.
- [x] Add failing migration/preflight contracts, then align scripts and guarded staging validation.
- [x] Rewrite architecture and cutover guidance around inspecting and migrating long-lived D1 databases in place.
- [x] Run focused staging contracts, the D1 migration chain, and full validation.

## Notes

- Historical config authority: `e44fa967:wrangler.jsonc`.
- Production uses Worker `maal` with D1 `maal-prod`; there is no `maal-prod` Worker.
- The shared browser Dexie database remains `maal-v1:<environment>`. This issue changes Cloudflare resource
  names, not the IndexedDB schema namespace.
- Remote operations are out of scope for this branch.
- Red: `pnpm exec vitest run tests/unit/deployment-resource-names.spec.ts` failed on every versioned Worker and
  D1 name.
- Green: the same command passes 3 tests. `pnpm gen` accepts the restored bindings.
- Red: the D1 schema proof could not find migrations through `maal-v1-local`; staging preflight contracts
  rejected `maal-staging`; the production migration contract still targeted `maal-v1-production`.
- Green: 15 focused unit contracts pass and `pnpm test:d1-schema` applies the complete local chain through
  `maal-local`.
- Red: the operator-document contract found versioned resource names, a staging D1 create command, and no
  production in-place migration sequence.
- Green: the architecture matrix and runbook identify all three long-lived environments. The staging and
  production procedures inspect, bookmark, and migrate the existing D1 databases without publishing IDs.
- Final staging contracts: 17 files and 126 tests passed, followed by the local D1 migration/schema proof.
- Final validation: formatting, ESLint, generated Worker types, Svelte diagnostics, 324 unit tests, production
  build, 187,208/256,000-byte entry budget, and 22 Playwright tests passed.
- Wrangler dry-runs resolved staging to `maal-staging` and production to `maal-prod`. Both exited before deploy.
