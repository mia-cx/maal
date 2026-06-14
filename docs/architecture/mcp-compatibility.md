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
