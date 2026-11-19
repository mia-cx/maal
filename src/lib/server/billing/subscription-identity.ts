export const deletionAllowsProjectedSubscription = (
	deletion: { readonly state: string; readonly stripeCancellationId: string | null } | null,
	subscription: { readonly stripeSubscriptionId: string } | null
): boolean => {
	if (deletion === null) return true;
	return (
		deletion.state === 'recovered' &&
		subscription !== null &&
		(deletion.stripeCancellationId === null ||
			subscription.stripeSubscriptionId !== deletion.stripeCancellationId)
	);
};
