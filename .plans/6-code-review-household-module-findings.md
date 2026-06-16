# #6 Code review: household module findings

## Summary

Address household module review findings around cross-system consistency, strict form parsing, WorkOS pagination/lookup behavior, invite mutation results, duplicated last-manager rules, and small view-loading cleanup.

## Acceptance criteria

- [ ] Household deletion performs local cleanup transactionally before external WorkOS deletion.
- [ ] Household settings updates validate payloads strictly and avoid concurrent DB/WorkOS partial updates.
- [ ] Member commands and member listing do not truncate after one WorkOS page.
- [ ] Household form payloads reject malformed strings/integers/JSON before mutation.
- [ ] Invite mutation commands report 404 when no invite row changed.
- [ ] Last-manager rule and household view reads are centralized/optimized where practical.
- [ ] Relevant household checks pass.

## TODOs

- [x] Add shared strict household form parsing helpers and apply them to invite/settings/appliance parsing.
- [x] Make invite mutation DAOs return affected-row counts and map zero-row mutations to 404.
- [x] Add WorkOS membership pagination helpers and centralize last-manager rule behavior.
- [x] Sequence/validate household settings updates with DB work before WorkOS updates and strict override schemas.
- [x] Make household deletion cleanup transactional before WorkOS deletion.
- [x] Optimize household view independent reads and run validation.

## Notes

- Issue source: GitHub #6.
- Added strict form parsing helpers and applied them to invite and appliance inputs. Settings strict override parsing follows in the settings TODO.
- Invite update, revoke, and delete now return affected row counts and 404 for missing invite ids.
- Member list and leave/remove flows now use WorkOS autoPagination and shared last-manager copy/logic.
- Household settings now validates JSON override rows and performs local DB updates before WorkOS organization changes.
- Household delete now computes dependent ids first, deletes local rows in one transaction, then deletes the WorkOS organization.
- Ran `pnpm exec wrangler types`, generated Paraglide files for local check, `pnpm check` passed after fixing appliance notes typing.
- Ran `pnpm test:unit -- --run src/lib/server/household src/lib/domain/household` and `pnpm architecture:check`; both passed.
