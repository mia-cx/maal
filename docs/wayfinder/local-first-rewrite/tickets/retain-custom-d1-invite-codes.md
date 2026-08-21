---
title: Retain custom D1 invite codes
parent: ../map.md
label: wayfinder:decision
status: closed
assignee: mia
blocked_by: []
---

## Question

Can the rewrite replace Maal's invite codes with WorkOS invitations to avoid D1 usage for free households?

## Resolution

No. WorkOS organizations and memberships remain authoritative, but Maal retains its own D1-backed household invite codes and the prototype's role, use-limit, expiry, revocation, and creator semantics. Store only a hash of the raw invite code.

Creating, inspecting, redeeming, or revoking an invite is an explicit remote household-administration action and may use the Worker, WorkOS, and D1 for a free household. Routine free recipe, meal, check-in, preference, and taxonomy use remains entirely local and creates no Worker or D1 traffic.

Preserve the prototype behavior: a 12-character code; default `member` role; default seven-day expiry with 1, 7, or 30-day choices; optional use limit from 1 through 100; `admin`, `member`, and `child` roles; atomic use consumption with rollback if WorkOS membership creation fails.
