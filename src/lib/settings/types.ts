export type SettingsCategoryId = 'account' | 'security' | 'mcp' | 'notifications' | 'billing';

export type User = { name: string; email: string; emailVerified: boolean };
export type UpdatedUser = { name: string | null; email: string; emailVerified: boolean };

export type MfaFactor = {
	id: string;
	type: 'totp';
	issuer: string;
	user: string;
	createdAt: string;
	updatedAt: string;
};

export type SettingsHousehold = { id: string; name: string };

export type BillingHouseholdStatus = {
	householdId: string;
	householdName: string;
	stripeCustomerId: string | null;
	subscriberUserId: string | null;
	status: string | null;
	currentPeriodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	isPaid: boolean;
	isActiveHousehold: boolean;
	canManageBilling: boolean;
};

export type BillingStatus = BillingHouseholdStatus & {
	householdBilling: BillingHouseholdStatus[];
	canManageBilling: boolean;
	publishableKey: string;
	pricingTableId: string;
	customerEmail: string;
};
