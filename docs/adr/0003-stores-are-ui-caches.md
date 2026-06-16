# ADR 0003: Treat client stores as UI caches

## Status

Accepted

## Context

Planning and menu stores were becoming tempting cross-feature service boundaries because they already held fetched data and mutations.

## Decision

Stores expose UI snapshots and cache reconciliation behavior. Network calls live in feature client adapters, and domain rules stay in shared/domain modules.

## Consequences

- Stores can remain small and testable.
- Feature components depend on public store contracts instead of internals.
- Cross-feature behavior should move to client adapters or domain APIs, not to another store.
