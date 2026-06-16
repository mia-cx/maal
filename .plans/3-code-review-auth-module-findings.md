# #3 Code review: auth module findings

## Summary

Harden `src/lib/server/auth` against the high- and medium-priority review findings: make invite consumption safe, avoid truncated WorkOS member lists, validate MCP KV records, treat malformed expirations as invalid, align smoke authorization, make MCP key index recovery robust, avoid retrying non-retryable invite insert errors, and return real household member counts.

## Acceptance criteria

- [ ] Invite joins consume invite uses with a conditional update so exhausted/revoked/expired invites cannot be overused.
- [ ] Household member listing reads every active WorkOS membership page.
- [ ] MCP key KV records are runtime-validated before authorization code uses them.
- [ ] Malformed expiry timestamps are treated as expired/invalid for invites and MCP keys.
- [ ] Smoke-user manage checks are restricted to the smoke household via shared logic.
- [ ] MCP key reroll/revoke/list recover from stale non-empty user indexes by scanning and reconciling records.
- [ ] Invite creation retries only expected unique id/code collisions and wraps other database failures with context.
- [ ] Active household member counts return the real active member count.
- [ ] Low-priority auth cleanups are addressed where small and safe.

## TODOs

- [x] Harden invite expiry parsing, atomic invite consumption, and invite creation retry behavior.
- [x] Fix household authorization/member helpers: shared smoke manage gate, WorkOS membership pagination, real active member counts, and cookie option reuse.
- [ ] Harden MCP key validation, expiration parsing, and stale-index recovery.
- [ ] Address small WorkOS runtime cleanups for cookie password length and cache key safety.
- [ ] Run auth-focused tests/checks and fix any regressions.
- [ ] File a PR targeting `main` with the executed plan and validation results.

## Notes

- Hardened invites with shared expiry parsing, conditional `usesCount` update, and uniqueness-only create retries.
- Household helper changes: added shared smoke-household gate, `autoPagination()` for active memberships, real active member counts, and aligned household cookie delete options. Meal serving defaults now apply their own minimum of 1 at call sites.
- Validation: deferred full checks until auth helper changes are complete.
- Issue source: https://github.com/mia-cx/maal/issues/3
- Worktree: `.worktrees/code-review-auth-fixes`
- Branch: `fix/code-review-auth-findings`
