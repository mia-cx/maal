# #23 Code review: root route findings

## Summary

Clean up remaining root/public route safety findings: make invite acceptance an explicit POST, tighten landing page failure behavior, and remove stale/unused legal policy data.

## Acceptance criteria

- [ ] Invite preview GET is safe/idempotent and acceptance requires POST with the route DB guard fixed.
- [ ] Landing page pricing failures are logged and exposed as degraded state instead of silently looking like no pricing.
- [ ] Legal policy current-version selection computes the date per request/load and the policy page stops returning unused archive data.
- [ ] Focused tests cover the changed route helpers and legal/landing behavior.
- [ ] `pnpm check` and `pnpm architecture:check` pass.

## TODOs

- [x] Refactor invite route so GET previews only and POST accepts invites with a safe DB lookup.
- [x] Add focused invite route tests for preview, missing DB, and POST acceptance behavior.
- [ ] Make landing load report pricing failures through an explicit degraded state.
- [ ] Fix legal policy date/archive handling and add focused tests.
- [ ] Run final validation, push the branch, and file the PR mentioning @pullfrog review.

## Notes

- Issue #23 also listed billing amount/null and household lookup overlap; the user scope says remaining #23 after extracting billing overlap into #17, so this plan focuses on invite GET mutation, landing failure behavior, and legal policy/date/archive cleanup.
- Refactored invite route: GET validates and renders an accept form only; POST performs the membership mutation. DB lookup now uses `platform?.env?.DB`.
- Validation: `pnpm exec vitest run 'src/routes/invite/[code]/server.test.ts'` passed.
