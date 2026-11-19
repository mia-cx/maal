## Parent PRD

#55

## What to build

Implement the paid stateless MCP server and rate-limited remote URL recipe-import adapter over the same domain services from spec §§7.4 and 8.3.

## Acceptance criteria

- [ ] `/mcp` uses SDK v2 `createMcpHandler` with a fresh server per request and no protocol Durable Object/SSE.
- [ ] Prototype presets, scopes, selected/all grants, hashing, revocation, expiry, and last-use behavior survive.
- [ ] Every request intersects key grant, membership, role, and active/grace plan.
- [ ] URL import returns a decoded candidate and cannot bypass the normal local recipe command.

## Blocked by

User sync, household sync, and billing slices.
