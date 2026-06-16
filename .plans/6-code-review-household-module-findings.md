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
- [ ] Make invite mutation DAOs return affected-row counts and map zero-row mutations to 404.
- [ ] Add WorkOS membership pagination helpers and centralize last-manager rule behavior.
- [ ] Sequence/validate household settings updates with DB work before WorkOS updates and strict override schemas.
- [ ] Make household deletion cleanup transactional before WorkOS deletion.
- [ ] Optimize household view independent reads and run validation.

## Notes
- Issue source: GitHub #6.
- Added strict form parsing helpers and applied them to invite and appliance inputs. Settings strict override parsing follows in the settings TODO.
