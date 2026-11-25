import { Schema } from 'effect';

import { UtcInstantSchema } from '$lib/domain/contracts/primitives.js';

export const stripeSubscriptionStatusValues = [
	'incomplete',
	'incomplete_expired',
	'trialing',
	'active',
	'past_due',
	'canceled',
	'unpaid',
	'paused'
] as const;

export const StripeSubscriptionStatusSchema = Schema.Literal(...stripeSubscriptionStatusValues);
export type StripeSubscriptionStatus = typeof StripeSubscriptionStatusSchema.Type;

export const BillingCapabilityStateSchema = Schema.Literal('enabled', 'grace', 'disabled');
export type BillingCapabilityState = typeof BillingCapabilityStateSchema.Type;

export const BillingCapabilitySchema = Schema.Struct({
	householdId: Schema.String,
	state: BillingCapabilityStateSchema,
	stripeStatus: Schema.NullOr(StripeSubscriptionStatusSchema),
	subscriberUserId: Schema.NullOr(Schema.String),
	stripePriceId: Schema.NullOr(Schema.String),
	currentPeriodEnd: Schema.NullOr(UtcInstantSchema),
	interruptionStartedAt: Schema.NullOr(UtcInstantSchema),
	graceUntil: Schema.NullOr(UtcInstantSchema),
	validUntil: Schema.NullOr(UtcInstantSchema),
	cancelAtPeriodEnd: Schema.Boolean,
	stale: Schema.Boolean,
	source: Schema.Literal('stripe-d1')
});
export type BillingCapability = typeof BillingCapabilitySchema.Type;

export const BillingPriceIntervalSchema = Schema.Literal('week', 'month', 'year');
export type BillingPriceInterval = typeof BillingPriceIntervalSchema.Type;

export const BillingPriceSchema = Schema.Struct({
	id: Schema.String,
	lookupKey: Schema.String,
	amountMinor: Schema.NonNegativeInt,
	currency: Schema.String,
	interval: BillingPriceIntervalSchema,
	intervalCount: Schema.Number.pipe(Schema.int(), Schema.positive())
});
export type BillingPrice = typeof BillingPriceSchema.Type;

export const BillingProjectionEnvelopeSchema = Schema.Struct({
	schemaVersion: Schema.Literal(1),
	capability: BillingCapabilitySchema,
	prices: Schema.Array(BillingPriceSchema),
	trialAvailable: Schema.Boolean,
	trialUnavailableReason: Schema.NullOr(
		Schema.Literal('user_already_claimed', 'household_already_claimed', 'already_subscribed')
	),
	refreshedAt: UtcInstantSchema
});
export type BillingProjectionEnvelope = typeof BillingProjectionEnvelopeSchema.Type;

export const BillingHouseholdRequestSchema = Schema.Struct({
	householdId: Schema.String.pipe(Schema.minLength(1))
});
export const BillingCheckoutRequestSchema = Schema.Struct({
	...BillingHouseholdRequestSchema.fields,
	priceId: Schema.String.pipe(Schema.minLength(1)),
	idempotencyKey: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(200))
});
export const BillingTrialRequestSchema = Schema.Struct({
	...BillingHouseholdRequestSchema.fields,
	priceId: Schema.optional(Schema.String.pipe(Schema.minLength(1)))
});
export const BillingTransferRequestSchema = Schema.Struct({
	...BillingHouseholdRequestSchema.fields,
	newSubscriberUserId: Schema.String.pipe(Schema.minLength(1))
});
