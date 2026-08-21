---
title: Keep the proven taxonomy model
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee: mia
blocked_by: []
---

## Question

Should the rewrite replace the prototype's normalized global, household, and user taxonomy tables with polymorphic scoped D1 rows?

## Resolution

Keep the prototype's normalized D1 taxonomy, aliases, unit conversions, preferences, constraints, and visibility semantics. The local-first rewrite does not justify changing a proven domain model.

Dexie stores a lossless, editable client projection with every global, household, and user entry; aliases; locales; source domains; unit families; conversion factors and offsets; paired-unit rules; display preferences; confidence; and original source text. Effective values are derived at query time. Round-trip tests prove that offline edits map back to typed D1 mutations without loss.
