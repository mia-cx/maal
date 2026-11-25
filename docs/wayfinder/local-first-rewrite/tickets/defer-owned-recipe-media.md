---
title: Defer owned recipe media
parent: ../map.md
label: wayfinder:decision
status: closed
assignee: mia
blocked_by: []
---

## Question

Does v1 ingest, store, synchronize, or export image bytes for recipes?

## Resolution

No. V1 preserves the prototype's image and media URL fields, ordering, kind, captions, names, source forms, and attribution. Imported recipes and manually edited recipes may reference online image URLs. Portable archives preserve those URLs and their provenance but do not crawl or bundle third-party content.

A later version may add user-owned recipe images, ingestion, local blob storage, R2 objects for paid sync, and binary archive entries. V1 has no R2 dependency.
