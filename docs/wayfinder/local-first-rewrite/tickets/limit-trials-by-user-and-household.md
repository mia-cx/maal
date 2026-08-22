---
title: Limit trials by user and household
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee: mia
blocked_by: []
---

## Question

How does Maal prevent repeated free trials through throwaway households or users?

## Resolution

Create a dedicated D1 trial-claim record before creating Stripe resources. Both `workos_user_id` and `household_id` are independently unique, so a user can claim at most one trial and a household can receive at most one trial.

A started trial consumes both allowances permanently. Release the claim only when trial creation fails and every external Stripe resource was removed. Retain rollback-pending claims for reconciliation.
