/**
 * WorkOS metadata grants: the Maal plan without a Stripe subscription, for comps, staff and beta.
 *
 * Set a grant in the WorkOS dashboard under one of `GRANT_METADATA_KEYS`, as a list of tokens
 * separated by spaces, commas or semicolons, for example `maal_grant: beta`:
 *
 * - On an organization (household): a grant token (`free`, `lifetime`, `employee`, `beta`,
 *   `reward`, optionally prefixed `maal:`), or any value under a `LIFETIME_GRANT_KEYS` key, grants
 *   every member of that household remote service.
 * - On a user: a grant token grants that user remote service in every household they belong to.
 *   Adding `household:<organizationId>` (or `maal:household:<organizationId>`) scopes the user's
 *   grant to the households it names. A user grant never covers the household's other members.
 */

const GRANT_TOKENS: ReadonlySet<string> = new Set(
	['free', 'lifetime', 'employee', 'beta', 'reward'].flatMap((token) => [token, `maal:${token}`])
);
const GRANT_METADATA_KEYS = ['maal_entitlement', 'maal_entitlements', 'maal_grant', 'maal_grants'];
const LIFETIME_GRANT_KEYS = ['lifetime_grant', 'maal_lifetime_grant'];
const HOUSEHOLD_SCOPE = /^(?:maal:)?household:(.+)$/;

type WorkOSMetadata = Readonly<Record<string, string>>;

interface Grant {
	/** A plan token is present. */
	readonly granted: boolean;
	/** Households named by `household:<id>` tokens; empty means unscoped. */
	readonly households: ReadonlySet<string>;
}

const readGrant = (metadata: WorkOSMetadata): Grant => {
	const tokens = GRANT_METADATA_KEYS.flatMap((key) => (metadata[key] ?? '').split(/[\s,;]+/));
	const households = new Set(tokens.flatMap((token) => HOUSEHOLD_SCOPE.exec(token)?.[1] ?? []));
	return {
		granted:
			tokens.some((token) => GRANT_TOKENS.has(token)) ||
			LIFETIME_GRANT_KEYS.some((key) => Object.hasOwn(metadata, key)),
		households
	};
};

const userGrantCovers = (grant: Grant, householdId: string): boolean =>
	grant.households.size > 0 ? grant.households.has(householdId) : grant.granted;

/** Whether WorkOS metadata on the user or the household grants this member the Maal plan there. */
export const workosMetadataGrantsHousehold = (input: {
	readonly householdId: string;
	readonly userMetadata: WorkOSMetadata;
	readonly organizationMetadata: WorkOSMetadata;
}): boolean =>
	userGrantCovers(readGrant(input.userMetadata), input.householdId) ||
	readGrant(input.organizationMetadata).granted;
