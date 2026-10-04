---
title: Retain one real session per local profile
parent: ../map.md
label: wayfinder:research
status: closed
assignee: mia
blocked_by: []
---

## Question

How can a Netflix-style local profile switcher retain several real WorkOS users without storing credentials in IndexedDB or creating free backend session state?

## Resolution

Prefer one random auth slot and path-scoped HTTP-only sealed WorkOS session cookie per retained profile. Dexie stores only safe identity, slot, PIN, entitlement, and session-status projections. Switching profiles changes local UI state and does not replace another profile's cookie. A locked or inactive profile may continue synchronizing through its own retained session.

The PIN prevents casual UI access and does not cryptographically lock credentials. Expired or revoked sessions pause remote features and prompt reauthentication while all local data remains usable. This design remains conditional on the linked real-browser proof ticket.
