# MCP compatibility rules

MCP tools are a public API surface.

Compatibility-preserving changes:

- adding optional input fields;
- adding response fields that callers can ignore;
- widening enum-like behavior only when existing values keep their meaning;
- improving validation messages without changing error codes.

Compatibility-breaking changes:

- renaming or deleting a tool;
- changing required inputs;
- changing the meaning of an existing input or response field;
- narrowing accepted values;
- changing destructive behavior or permission scope requirements.

Breaking changes need an explicit migration path: add a new tool or field first, keep the old one working for at least one release window, document the replacement, then remove only after callers can migrate.

`src/lib/server/mcp/tools.test.ts` snapshots the public tool order and names. Update it only when an intentional MCP contract change is reviewed.

## Module ownership

- `protocol.ts` owns HTTP transport, bearer-key discovery responses, and MCP server lifecycle.
- `context.ts` owns scope and household resolution.
- `registry.ts` owns list/call tool protocol registration and schema decoding.
- `results.ts` owns structured result/error formatting.
- `*-adapter.ts` modules expose domain-specific tool sets to the registry.
- Tool implementations should call domain public APIs, not route handlers.

New tools should start in the appropriate domain adapter, add/extend input mapping tests when arguments are non-trivial, and update the public tool snapshot only after confirming the public contract is intentional.
