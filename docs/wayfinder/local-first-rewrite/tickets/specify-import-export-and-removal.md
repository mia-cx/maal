---
title: Specify import, export, and profile removal
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee:
blocked_by:
  - Specify exact Effect and D1 contracts
  - Specify the device Dexie schema
---

## Question

What versioned portable archive preserves user-owned and household-visible data, how are imports merged, and which local records survive signing out or removing one profile from a shared device?

## Settled constraints

- An export contains everything the active user is authorized to see, including complete current household snapshots, their user-owned recipes and preferences, recoverable deleted recipes, and visible detached snapshots.
- Never include credentials, auth-slot cookies, PIN verifiers, entitlement projections, sync cursors, outbox internals, leases, or other implementation state.
- V1 uses an unencrypted portable archive and clearly warns that the file contains private household data.
- Export is available without a subscription.
- Restoring into an empty database preserves archive IDs.
- Merge ignores records whose ID and content are identical. A divergent matching ID requires `keep local`, `replace`, or `import as copy`; the UI supports applying one choice to the remaining collisions.
- `Import as copy` allocates new aggregate and child IDs and rewrites internal references consistently. File timestamps never silently overwrite local data.
- When importing under a different real user, user-owned recipes become copies owned by the importer. Household data may restore under its archived household identity only when the importer is a current WorkOS member; otherwise it imports as a new local household with new IDs and preserved display attribution. An archive never grants membership or permits impersonating an original author.
- V1 archives are ordinary unencrypted ZIP files with a clear privacy warning. Authentication material and implementation state remain excluded even though the domain content is not classified as highly sensitive.

## Resolution

Specified in `docs/architecture/local-first-rewrite-spec.md` §§4.3 and 9.
