import type Stripe from 'stripe';

import { BillingConflictError } from './errors.js';
import type { BillingRepository, HouseholdDeletionRow } from './repository.js';

const RECOVERY_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

const expandedId = (value: string | { id: string } | null): string | null =>
	value === null ? null : typeof value === 'string' ? value : value.id;

const safeCode = (cause: unknown): string =>
	cause instanceof Error && '_tag' in cause && typeof cause._tag === 'string'
		? cause._tag.slice(0, 80)
		: 'household_deletion_failed';

const recoveryDeadline = (now: string): string =>
	new Date(Date.parse(now) + RECOVERY_MILLISECONDS).toISOString();

export const reconcileHouseholdDeletionRefund = async (input: {
	repository: BillingRepository;
	refund: Stripe.Refund;
	now: string;
}): Promise<HouseholdDeletionRow | null> => {
	const request = await input.repository.deletionRequestByRefundId(input.refund.id);
	if (
		!request ||
		request.state === 'recoverable' ||
		request.state === 'purged' ||
		request.state === 'recovered'
	) {
		return request;
	}
	const requiredAmount = request.previewedAmountMinor ?? 0;
	const refundMatches =
		input.refund.amount >= requiredAmount &&
		(request.currency === null || input.refund.currency === request.currency);
	const succeeded = input.refund.status === 'succeeded' && refundMatches;
	const recoverableUntil = succeeded ? recoveryDeadline(input.now) : null;
	const state = succeeded
		? 'recoverable'
		: input.refund.status === 'failed' || input.refund.status === 'canceled'
			? 'failed'
			: 'refunding';
	const safeErrorCode = succeeded
		? null
		: !refundMatches
			? 'refund_mismatch'
			: `refund_${input.refund.status ?? 'pending'}`;
	await input.repository.upsertDeletionRequest({
		...request,
		state,
		refundedAmountMinor: input.refund.amount,
		recoverableUntil,
		safeErrorCode,
		updatedAt: input.now
	});
	if (succeeded) {
		await input.repository.audit({
			idempotencyKey: `household:${request.householdId}:deletion-requested`,
			householdId: request.householdId,
			actorUserId: request.requesterUserId,
			eventType: 'household_deletion_recoverable',
			occurredAt: input.now,
			safeDetails: {
				refundedAmountMinor: input.refund.amount,
				currency: input.refund.currency,
				recoverableUntil
			}
		});
	}
	return input.repository.deletionRequest(request.householdId);
};

export const reconcileOutstandingHouseholdDeletionRefunds = async (input: {
	repository: BillingRepository;
	stripe: Stripe;
	now: string;
	limit?: number;
}): Promise<{ reconciled: number; pending: number }> => {
	const requests = await input.repository.outstandingDeletionRefunds(input.limit);
	let reconciled = 0;
	let pending = 0;
	for (const request of requests) {
		try {
			const refund = await input.stripe.refunds.retrieve(request.stripeRefundId!);
			const next = await reconcileHouseholdDeletionRefund({
				repository: input.repository,
				refund,
				now: input.now
			});
			if (next?.state === 'recoverable') reconciled += 1;
			else pending += 1;
		} catch {
			pending += 1;
		}
	}
	return { reconciled, pending };
};

export const proratedRefundMinor = (input: {
	amountPaidMinor: number;
	refundableMinor: number;
	periodStartSeconds: number;
	periodEndSeconds: number;
	nowSeconds: number;
}): number => {
	const periodLength = Math.max(1, input.periodEndSeconds - input.periodStartSeconds);
	const remaining = Math.max(0, input.periodEndSeconds - input.nowSeconds);
	const prorated = Math.floor(input.amountPaidMinor * Math.min(1, remaining / periodLength));
	return Math.max(0, Math.min(prorated, input.refundableMinor));
};

const refundableCharge = async (
	stripe: Stripe,
	subscription: Stripe.Subscription,
	now: string
): Promise<{ chargeId: string; amountMinor: number; currency: string } | null> => {
	const invoiceId = expandedId(subscription.latest_invoice);
	const item = subscription.items.data[0];
	if (!invoiceId || !item) return null;
	const invoice = await stripe.invoices.retrieve(invoiceId);
	if (invoice.amount_paid <= 0) return null;
	const payments = await stripe.invoicePayments.list({
		invoice: invoiceId,
		status: 'paid',
		limit: 100
	});
	const payment = payments.data.find(({ amount_paid }) => (amount_paid ?? 0) > 0);
	if (!payment) return null;
	let chargeId = expandedId(payment.payment.charge ?? null);
	if (!chargeId && payment.payment.payment_intent) {
		const paymentIntentId = expandedId(payment.payment.payment_intent);
		if (paymentIntentId) {
			const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
			chargeId = expandedId(paymentIntent.latest_charge);
		}
	}
	if (!chargeId) return null;
	const charge = await stripe.charges.retrieve(chargeId);
	const refundable = Math.max(0, charge.amount - charge.amount_refunded);
	return {
		chargeId,
		amountMinor: proratedRefundMinor({
			amountPaidMinor: invoice.amount_paid,
			refundableMinor: refundable,
			periodStartSeconds: item.current_period_start,
			periodEndSeconds: item.current_period_end,
			nowSeconds: Math.floor(Date.parse(now) / 1_000)
		}),
		currency: invoice.currency
	};
};

export const deleteHouseholdAfterRefund = async (input: {
	stripe: Stripe;
	repository: BillingRepository;
	householdId: string;
	requesterUserId: string;
	now: string;
}): Promise<HouseholdDeletionRow> => {
	const existingRequest = await input.repository.deletionRequest(input.householdId);
	if (
		existingRequest?.state === 'recoverable' ||
		existingRequest?.state === 'purged' ||
		(existingRequest?.state === 'requested' && existingRequest.safeErrorCode === 'purge_claimed')
	) {
		return existingRequest;
	}
	const billing = await input.repository.subscription(input.householdId);
	if (billing?.subscriberUserId && billing.subscriberUserId !== input.requesterUserId) {
		throw new BillingConflictError('billing_owner_required');
	}
	let request = existingRequest;
	try {
		let refundPreview = request?.stripeChargeId
			? {
					chargeId: request.stripeChargeId,
					amountMinor: request.previewedAmountMinor ?? 0,
					currency: request.currency ?? 'eur'
				}
			: null;
		let subscription: Stripe.Subscription | null = null;
		if (billing?.stripeSubscriptionId) {
			subscription = await input.stripe.subscriptions.retrieve(billing.stripeSubscriptionId, {
				expand: ['latest_invoice', 'items.data.price']
			});
			refundPreview ??= await refundableCharge(input.stripe, subscription, input.now);
		}
		await input.repository.upsertDeletionRequest({
			householdId: input.householdId,
			requesterUserId: input.requesterUserId,
			state: 'cancelling',
			stripeCancellationId: request?.stripeCancellationId ?? null,
			stripeChargeId: refundPreview?.chargeId ?? null,
			stripeRefundId: request?.stripeRefundId ?? null,
			previewedAmountMinor: refundPreview?.amountMinor ?? 0,
			refundedAmountMinor: request?.refundedAmountMinor ?? null,
			currency: refundPreview?.currency ?? null,
			requestedAt: request?.requestedAt ?? input.now,
			recoverableUntil: null,
			purgedAt: null,
			safeErrorCode: null,
			updatedAt: input.now
		});
		if (subscription && subscription.status !== 'canceled' && !request?.stripeCancellationId) {
			await input.stripe.subscriptions.cancel(
				subscription.id,
				{
					invoice_now: false,
					prorate: false,
					cancellation_details: { comment: 'Household deletion with direct cash refund' }
				},
				{ idempotencyKey: `maal-delete-cancel:${input.householdId}` }
			);
		}
		const cancellationId = subscription?.id ?? request?.stripeCancellationId ?? null;
		await input.repository.upsertDeletionRequest({
			householdId: input.householdId,
			requesterUserId: input.requesterUserId,
			state: 'refunding',
			stripeCancellationId: cancellationId,
			stripeChargeId: refundPreview?.chargeId ?? null,
			stripeRefundId: request?.stripeRefundId ?? null,
			previewedAmountMinor: refundPreview?.amountMinor ?? 0,
			refundedAmountMinor: request?.refundedAmountMinor ?? null,
			currency: refundPreview?.currency ?? null,
			requestedAt: request?.requestedAt ?? input.now,
			recoverableUntil: null,
			purgedAt: null,
			safeErrorCode: null,
			updatedAt: input.now
		});

		let refundId = request?.stripeRefundId ?? null;
		let refundedAmountMinor = request?.refundedAmountMinor ?? 0;
		let refund: Stripe.Refund | null = null;
		if (refundPreview && refundPreview.amountMinor > 0 && !refundId) {
			refund = await input.stripe.refunds.create(
				{
					charge: refundPreview.chargeId,
					amount: refundPreview.amountMinor,
					metadata: { householdId: input.householdId, reason: 'prorated_household_deletion' }
				},
				{ idempotencyKey: `maal-delete-refund:${input.householdId}` }
			);
			refundId = refund.id;
			refundedAmountMinor = refund.amount;
		} else if (refundId) {
			refund = await input.stripe.refunds.retrieve(refundId);
			if (refundPreview && (refund.status === 'failed' || refund.status === 'canceled')) {
				const failedRefundId = refund.id;
				refund = await input.stripe.refunds.create(
					{
						charge: refundPreview.chargeId,
						amount: refundPreview.amountMinor,
						metadata: {
							householdId: input.householdId,
							reason: 'prorated_household_deletion_retry'
						}
					},
					{ idempotencyKey: `maal-delete-refund:${input.householdId}:after:${failedRefundId}` }
				);
				refundId = refund.id;
				refundedAmountMinor = refund.amount;
			}
		}
		await input.repository.upsertDeletionRequest({
			householdId: input.householdId,
			requesterUserId: input.requesterUserId,
			state: refund ? 'refunding' : 'recoverable',
			stripeCancellationId: cancellationId,
			stripeChargeId: refundPreview?.chargeId ?? null,
			stripeRefundId: refundId,
			previewedAmountMinor: refundPreview?.amountMinor ?? 0,
			refundedAmountMinor,
			currency: refundPreview?.currency ?? null,
			requestedAt: request?.requestedAt ?? input.now,
			recoverableUntil: refund ? null : recoveryDeadline(input.now),
			purgedAt: null,
			safeErrorCode: null,
			updatedAt: input.now
		});
		if (refund) {
			return (
				(await reconcileHouseholdDeletionRefund({
					repository: input.repository,
					refund,
					now: input.now
				})) ?? (await input.repository.deletionRequest(input.householdId))!
			);
		}
		const recoverableUntil = recoveryDeadline(input.now);
		await input.repository.audit({
			idempotencyKey: `household:${input.householdId}:deletion-requested`,
			householdId: input.householdId,
			actorUserId: input.requesterUserId,
			eventType: 'household_deletion_recoverable',
			occurredAt: input.now,
			safeDetails: {
				refundedAmountMinor,
				currency: refundPreview?.currency ?? null,
				recoverableUntil
			}
		});
		return (await input.repository.deletionRequest(input.householdId))!;
	} catch (cause) {
		request = await input.repository.deletionRequest(input.householdId);
		await input.repository.upsertDeletionRequest({
			householdId: input.householdId,
			requesterUserId: input.requesterUserId,
			state: 'failed',
			stripeCancellationId: request?.stripeCancellationId ?? null,
			stripeChargeId: request?.stripeChargeId ?? null,
			stripeRefundId: request?.stripeRefundId ?? null,
			previewedAmountMinor: request?.previewedAmountMinor ?? null,
			refundedAmountMinor: request?.refundedAmountMinor ?? null,
			currency: request?.currency ?? null,
			requestedAt: request?.requestedAt ?? input.now,
			recoverableUntil: request?.recoverableUntil ?? null,
			purgedAt: null,
			safeErrorCode: safeCode(cause),
			updatedAt: input.now
		});
		throw cause;
	}
};

export const recoverDeletedHousehold = async (input: {
	repository: BillingRepository;
	householdId: string;
	actorUserId: string;
	now: string;
}): Promise<void> => {
	const recovered = await input.repository.recoverHousehold(input.householdId, input.now);
	if (!recovered) throw new BillingConflictError('recovery_window_closed');
	await input.repository.audit({
		idempotencyKey: `household:${input.householdId}:recovered`,
		householdId: input.householdId,
		actorUserId: input.actorUserId,
		eventType: 'household_recovered_without_subscription',
		occurredAt: input.now
	});
};

export const purgeExpiredHouseholds = async (input: {
	repository: BillingRepository;
	now: string;
	deleteWorkOSOrganization: (householdId: string) => Promise<void>;
	householdLimit?: number;
	rowBatchSize?: number;
}): Promise<{ purged: string[]; pending: string[]; rowsDeleted: number }> => {
	const householdLimit = input.householdLimit ?? 10;
	await input.repository.claimExpiredRecoverableHouseholds(input.now, householdLimit);
	const householdIds = await input.repository.claimedHouseholdPurges(input.now, householdLimit);
	const purged: string[] = [];
	const pending: string[] = [];
	let rowsDeleted = 0;
	for (const householdId of householdIds) {
		await input.deleteWorkOSOrganization(householdId);
		const result = await input.repository.purgeHouseholdContentBatch(
			householdId,
			input.now,
			input.rowBatchSize
		);
		rowsDeleted += result.rowsDeleted;
		(result.complete ? purged : pending).push(householdId);
	}
	return { purged, pending, rowsDeleted };
};
