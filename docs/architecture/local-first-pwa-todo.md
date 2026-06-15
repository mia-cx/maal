# Local-first PWA TODOs

## Deferred: authenticated runtime cache hardening

The current service worker intentionally provides a temporary app-shell/runtime GET cache while the full local-first IndexedDB sync model is still future work.

Risk accepted for this refactor PR:

- `src/service-worker.ts` runtime-caches successful same-origin GET responses unless the path is network-only.
- Authenticated app pages and route data can therefore be served stale from Cache Storage on the same browser profile.
- This is acceptable temporarily for installability/app-shell exploration, but it is not the final local-first data model.

Required follow-up before treating offline mode as production-grade:

1. Restrict service-worker runtime caching to static/public assets or an explicit non-sensitive allowlist.
2. Keep authenticated app/API routes network-only until their data is stored through the encrypted/signed IndexedDB sync layer.
3. Clear runtime caches on logout and account/household switch.
4. Move durable household, plan, menu, and settings data to Dexie/IndexedDB with explicit sync cursors and outbox semantics.
5. Add browser/e2e coverage for logout/account-switch cache isolation.

Owner: local-first PWA follow-up worktree / `plan/local-first-pwa`.
