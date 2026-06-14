# ADR 0001: Keep SvelteKit routes as adapters

## Status

Accepted

## Context

Route files were accumulating authentication, request decoding, domain orchestration, persistence, and response mapping. The same behavior also needed to be reused by MCP tools and client feature commands.

## Decision

Route files own transport concerns only: context construction, request decoding, redirects/status codes, and response payload shape. Reusable behavior moves behind server domain APIs, application services, or feature client adapters.

## Consequences

- Business rules can be reused by MCP and HTTP without route imports.
- Route files should stay small and easy to audit.
- New shared route concerns should become HTTP helper modules before the third copy appears.
