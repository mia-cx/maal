---
title: Use the prototype domain model as baseline
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee: mia
blocked_by: []
---

## Question

Which prior source defines the product data that the rewrite must preserve?

## Resolution

The implemented prototype at `74a12ec38f6c297d1a6adbf596234c45212bac11` is the behavioral and data-model baseline. Preserve every used field, enum, check, uniqueness rule, relationship, and delete behavior unless another ticket explicitly changes it. Draft-only DTO concepts do not enter v1 automatically.

The rewrite may change persistence structure, but every structural change requires lossless mapping or an explicit product decision. Add Effect contracts, Dexie aggregates, revisions, tombstones, conflict groups, outbox records, and D1 change sequencing around that baseline.
