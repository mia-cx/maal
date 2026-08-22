export const deletionAllowsProjectedSubscription = (
	deletion: { readonly state: string; readonly stripeCancellationId: string | null } | null,
	subscription: { readonly stripeSubscriptionId: string } | null
): boolean => {
	if (deletion === null) return true;
	return (
		deletion.state === 'recovered' &&
		deletion.stripeCancellationId !== null &&
		subscription !== null &&
		subscription.stripeSubscriptionId !== deletion.stripeCancellationId
	);
};
