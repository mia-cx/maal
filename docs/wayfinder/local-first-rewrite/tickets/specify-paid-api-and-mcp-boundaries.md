---
title: Specify paid API and MCP boundaries
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee:
blocked_by:
  - Specify exact Effect and D1 contracts
  - Prove the Maal entitlement bridge
---

## Question

How do billing, import, sync, MCP, and future remote integrations derive capabilities from the single Maal plan while local commands remain ungated and routine free content use produces no Worker or D1 activity?

## Settled MCP constraints

- Rebuild the MCP endpoint on the Agents SDK stateless server path: an SDK v2 `McpServer` factory passed to `createMcpHandler` from `agents/mcp/server`.
- Serve Streamable HTTP at `/mcp`; do not introduce `McpAgent`, a protocol Durable Object, SSE transport, or protocol session state.
- Create an isolated MCP server instance per request. Durable Maal business state remains behind authenticated D1 domain services, not in MCP transport state.
- Preserve the prototype's selected-household and all-current-and-future-households grant modes, presets, read/write scopes, one-time raw key display, hashed storage, expiry, revocation, and last-use metadata.
- Effective access is the intersection of the key grant, the owner's current WorkOS membership, domain role permissions, and the household's active Maal plan. Membership removal or plan expiry denies the next request even if the stored grant remains.
- Portable file import/export remains free. Remote URL recipe fetch/parsing is an existing server-backed feature included in the single Maal plan and separately rate-limited.

## Resolution

Specified in `docs/architecture/local-first-rewrite-spec.md`, especially §§1, 7.3–7.5, 8.3, and 9.
