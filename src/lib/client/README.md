# Client

Browser-only adapters live here. Dexie repositories, live-query adapters, the shared device database, service-worker
coordination, and ephemeral UI state belong in this boundary. Components observe Dexie-derived adapters only;
HTTP responses never hydrate component state directly.

`local/` owns the `maal-v1:<environment>` database, transaction-safe command/outbox writes, decoded live
queries, sync leases, and explicit recovery controls. Domain slices add schemas and repositories through these
interfaces instead of creating another database.

`taxonomy/` owns offline taxonomy commands, field-complete snapshot queries, and decoded live preference
projections. The compatibility store in `src/lib/stores/taxonomy-preferences.ts` binds the approved prototype
UI seam to those Dexie projections and never refreshes through HTTP.
