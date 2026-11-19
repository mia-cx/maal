---
title: Specify exact Effect and D1 contracts
parent: ../map.md
label: wayfinder:task
status: closed
assignee:
blocked_by:
  - Use the prototype domain model as baseline
  - Keep the proven taxonomy model
---

## Question

What are the field-complete Effect schemas, enums, D1 tables, checks, keys, relationships, and aggregate mappers for every in-scope prototype domain plus new billing and synchronization infrastructure?

## Completion

Produce an implementable schema specification that accounts for every item in `docs/research/prototype-schema-inventory.md`. Preserve focused check-ins and meal statuses `planned`, `cooked`, and `skipped`. Exclude only the map's explicit out-of-scope domains.

## Resolution

Completed in `docs/architecture/local-first-rewrite-spec.md` §§3, 5, and 7. The prototype omission checklist is fully dispositioned.
