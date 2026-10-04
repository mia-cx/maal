---
title: Make Dexie the UI authority
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee: mia
blocked_by: []
---

## Question

Which runtime owns authenticated application state, and where do domain writes become visible?

## Resolution

The UI reads typed Dexie live queries only. A local command validates intent, updates its aggregate, and appends any sync mutation atomically in IndexedDB. HTTP never hydrates components directly. Remote changes become visible only after they are decoded and applied to Dexie.

The browser service worker owns the application shell and may run optional background sync. A foreground coordinator remains the reliable synchronization path. The Cloudflare Worker authenticates remote operations and owns D1 access.
