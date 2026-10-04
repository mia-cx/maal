# Effect Schema contract conventions

Effect Schema is the canonical runtime contract system. TypeScript types derived from schemas are convenient,
but the schema remains authoritative at every persistence and network boundary.

## Naming and ownership

- Export runtime values as `<Name>Schema` and inferred types as `<Name>`.
- Define each aggregate contract beside its owning domain module, not beside an HTTP route or database table.
- Use one explicit version for every persisted aggregate and one `protocolVersion` for each sync envelope.
- Preserve input/output type distinctions when a schema transforms values.
- Build command schemas from named field-group schemas so conflict groups remain explicit.

## Boundary rules

Decode unknown input before calling domain code. This applies to request bodies, route parameters, WorkOS and
Stripe payloads, D1 row mappings, Dexie records, import results, MCP arguments, and service-worker messages.
Encode domain values before persistence or transport. No unchecked cast may stand in for decoding.

Decode once at the adapter boundary. Svelte components do not execute Effects, decode schemas, query domain
repositories, or receive unchecked JSON. Client adapters expose Promise-like commands and live stores whose
values have already been decoded.

## Versioning

- Additive compatible fields start optional and receive defaults during decoding.
- A breaking persisted change introduces a new aggregate version and an explicit migration decoder.
- Writers emit only the current version; readers support every version still present in a supported database.
- Unknown future versions fail closed and surface a recoverable upgrade error.
- Network protocol support spans the current and previous release during rollout.

## Errors and tests

Adapters translate parse failures into boundary-specific errors without logging payload contents. Tests cover
decode/encode round trips, unknown and malformed input, every supported persisted version, and migration into
the current version. `src/lib/domain/contracts/schema.ts` provides the common versioned-envelope primitive.
