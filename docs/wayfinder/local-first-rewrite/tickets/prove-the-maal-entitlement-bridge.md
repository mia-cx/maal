---
title: Prove the Maal entitlement bridge
parent: ../map.md
label: wayfinder:task
status: open
assignee:
blocked_by: []
---

## Question

Can WorkOS staging and a standard Stripe account's test mode propagate one Product-level `maal` entitlement for weekly, monthly, yearly, trialing, canceled, second-member, and multi-household cases while Maal retains direct Stripe checkout and trial rules?

## Completion

Run and record every case in `docs/research/billing-catalog-options.md`, renamed around Product `Maal` and entitlement `maal`. Direct Stripe webhooks plus the D1 billing projection are canonical regardless of the result. If the WorkOS entitlement passes, use it as a session optimization; if it fails, omit it without changing checkout, capability, or sync contracts.
