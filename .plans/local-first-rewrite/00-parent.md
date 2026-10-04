# Maal local-first rewrite

Implement the complete architecture and schema in `docs/architecture/local-first-rewrite-spec.md` on one integration branch and one pull request.

The implementation must preserve the prototype domain model and the complete in-scope product UI at `main` commit `74a12ec38f6c297d1a6adbf596234c45212bac11` while making Dexie authoritative, keeping routine free content use off the Worker and D1, and adding optional paid synchronization, billing, stateless MCP, and PWA behavior. This is a data-plumbing rewrite, not a redesign.

## Completion

- [ ] Every attached implementation slice is complete.
- [ ] The WorkOS auth-slot and entitlement behaviors are proven against staging or their specified fallbacks are used.
- [ ] Unit, integration, browser, sync, billing, MCP, and PWA release gates pass.
- [ ] Prototype routes/components/interactions are reused at their data seams, including the custom scroll SDK and complete calendar/schedule UI; visual and interaction parity passes on phone and desktop.
- [ ] The implementation pull request passes independent code review and is ready for human review.

## Canonical specification

`docs/architecture/local-first-rewrite-spec.md`
