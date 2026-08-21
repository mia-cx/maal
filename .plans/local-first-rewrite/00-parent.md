# Maal local-first rewrite

Implement the complete architecture and schema in `docs/architecture/local-first-rewrite-spec.md` on one integration branch and one pull request.

The implementation must preserve the prototype domain model while making Dexie authoritative, keeping routine free content use off the Worker and D1, and adding optional paid synchronization, billing, stateless MCP, and PWA behavior.

## Completion

- [ ] Every attached implementation slice is complete.
- [ ] The WorkOS auth-slot and entitlement behaviors are proven against staging or their specified fallbacks are used.
- [ ] Unit, integration, browser, sync, billing, MCP, and PWA release gates pass.
- [ ] The implementation pull request passes independent code review and is ready for human review.

## Canonical specification

`docs/architecture/local-first-rewrite-spec.md`
