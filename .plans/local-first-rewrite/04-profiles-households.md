## Parent PRD

#55

## What to build

Deliver the offline profile switcher and household settings/member/invite administration slice, including cached permissions and detached snapshots, from spec §4 and §5.1.

## Acceptance criteria

- [ ] Several real profiles share household data immediately on one installation.
- [ ] Household settings, appliances, roles, custom hashed invite codes, and membership operations preserve prototype behavior.
- [ ] Sign-out, device removal, membership loss, and detached/forked snapshots follow the specification.
- [ ] Routine local household content use performs no remote request.

## Blocked by

Local runtime, auth-slot, and shared prototype-UI baseline slices.
