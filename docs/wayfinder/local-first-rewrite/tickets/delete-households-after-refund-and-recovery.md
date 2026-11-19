---
title: Delete households after refund and recovery
parent: ../map.md
label: wayfinder:decision
status: closed
assignee: mia
blocked_by: []
---

## Question

How can an admin delete a household that still has paid time remaining?

## Resolution

A household cannot enter deletion while it has an active subscription. The confirmed deletion flow first cancels the subscription immediately. If the paid billing period has unused time, Maal returns the prorated amount to the original payment method rather than leaving it as Stripe customer credit. Trial time has no refundable payment.

Stripe cancellation prorations do not automatically guarantee a cash refund. The implementation must preview the unused amount, cancel with the appropriate proration/final-invoice behavior, explicitly issue the refund, and clear any corresponding customer credit. This is a tested, idempotent billing saga; failure leaves `household_deletion_requests` in a resumable `refund_pending` or `cancellation_pending` state rather than deleting data.

After cancellation and any required refund succeed, remote access stops and the household enters a 30-day recoverable deletion period. Existing devices retain detached local snapshots. Recovery restores the household but does not silently recreate its subscription. At the deadline, a scheduled purge removes household D1 domain data and tombstones, invite codes, billing projections that are no longer needed for financial audit, and then the WorkOS organization. Minimal immutable billing/refund audit identifiers may remain for legal, fraud, and idempotency requirements but contain no meal or recipe content.
