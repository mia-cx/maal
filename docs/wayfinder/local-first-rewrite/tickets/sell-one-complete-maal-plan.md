---
title: Sell one complete Maal plan
parent: ../map.md
label: wayfinder:grilling
status: closed
assignee: mia
blocked_by: []
---

## Question

How should billing packages map to local and remote capabilities?

## Resolution

Maal has one household-level paid plan with no tiers or add-ons. One Stripe Product named `Maal` has weekly, monthly, and yearly recurring Prices plus a trial flow. One durable paid entitlement enables sync, MCP, and every future server-backed feature. Features that can run cleanly on the device remain free.

The subscribing user is the billing owner. An active billing owner cannot leave the household until they transfer billing responsibility to another household admin or cancel the subscription. Billing transfer must update both Stripe customer/subscription metadata and the D1 billing projection before membership removal can succeed.

`active` and `trialing` have remote access. A transition to `past_due` or an intentional paused state starts one continuous 30-day grace window during which sync and MCP remain available. The grace start does not reset through repeated pause/resume or webhook churn; it resets only after a successful paid period begins. After the grace deadline, remote services stop while all local use continues. Other terminal or incomplete statuses have no grace unless they are recovering the same recorded interruption.

The exact Stripe-to-WorkOS entitlement bridge remains subject to the linked dashboard proof ticket.
