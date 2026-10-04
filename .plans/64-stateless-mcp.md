# #64 Stateless MCP and paid URL recipe import

## Summary

Serve the prototype MCP contract through the stateless SDK-v2 handler. Authorize every request from live WorkOS, D1 membership, key grants, and billing state. Share the normalized D1 command/query port and the paid URL fetch boundary with HTTP.

## Acceptance criteria

- [x] `/mcp` uses `createMcpHandler` with a fresh low-level SDK-v2 server per request.
- [x] The exact 13-tool, 10-scope, 3-preset public contract and key lifecycle remain stable.
- [x] Every request and tool target intersects live WorkOS, D1, billing, scope, and grant state.
- [x] Browser URL import returns a decoded candidate without a domain write.
- [x] MCP URL import uses the shared parser and normalized D1 command port.
- [x] Modern and legacy SDK-v2 clients pass the proof matrix without protocol sessions.

## TODOs

- [x] Add the exact SDK-v2 dependency generation and shared MCP/key contracts.
- [x] Implement D1 key lifecycle and fail-closed request authorization.
- [x] Implement shared normalized remote domain query/command ports and all 13 tools.
- [x] Implement the paid, rate-limited, SSRF-safe URL candidate boundary and browser endpoint.
- [x] Compose the authenticated stateless `/mcp` route with the Agents handler.
- [x] Add protocol, authorization-transition, contract, parity, and URL safety tests.
- [x] Run focused validation, D1 schema checks, and the full project validation.

## Notes

- Prototype authority is `main` at `74a12ec38f6c297d1a6adbf596234c45212bac11`.
- Current Cloudflare handler and rate-limit docs were retrieved on 2026-08-22.
