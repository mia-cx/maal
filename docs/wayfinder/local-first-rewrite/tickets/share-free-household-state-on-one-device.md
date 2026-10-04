---
title: Share free household state on one device
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee: mia
blocked_by: []
---

## Question

How do several real users share one free household on a kitchen tablet without paid remote synchronization?

## Resolution

Use one Dexie database per deployment and browser installation, with logically user-owned and household-owned records. Several retained real-user profiles share household records immediately on that device. Active-profile queries enforce visibility from cached membership projections.

Free household data does not cross devices automatically. Cross-device convergence requires the Maal plan or explicit file export and import.
