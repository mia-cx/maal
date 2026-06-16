# Route adapter guideline

SvelteKit routes are transport adapters, not domain owners.

A route may:

- authenticate and build request context;
- decode URL params, query params, and request bodies;
- call a public domain command/query;
- map expected domain errors to HTTP responses;
- return JSON, redirects, or page data.

A route must not:

- duplicate business rules already needed by MCP tools, client commands, or another route;
- import another route module;
- reach into domain internals when a public domain API exists;
- own cross-domain orchestration that belongs in an application service.

Use this default shape:

```ts
export const POST: RequestHandler = async (event) => {
	const context = await requireAppContext(event);
	const input = await readJsonObject(event.request);
	const result = await domainCommand(context, input);
	return json(result);
};
```

When route-specific behavior is unavoidable, keep it transport-specific: status codes, redirects, headers, cookie/session refresh, and form failure payloads.

## Current shared adapter helpers

- `requireAppContext` centralizes authenticated app route setup.
- `readJsonObject` centralizes JSON body parsing at HTTP boundaries.
- `mapKnownError` handles expected domain-error to HTTP mapping.
- Domain APIs under `src/lib/server/domains/*` are preferred over service internals.
- MCP uses its own protocol adapter under `src/lib/server/mcp/protocol.ts`; HTTP routes should not duplicate MCP protocol behavior.

## Client adapters

Client components should not build route URLs directly when a feature client adapter exists. Planning fetches and mutations live behind dashboard/planning client helpers; menu recipe fetch/mutation calls live behind `src/lib/menu/menu-client.ts`.
