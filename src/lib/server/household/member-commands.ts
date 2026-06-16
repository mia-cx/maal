import { householdRoleSlug } from '$lib/server/auth/household-invites';
import type { AuthSession } from '$lib/server/auth/session';
import { createAuthRuntime } from '$lib/server/auth/workos';
import { getDb } from '$lib/server/db';
import { householdMembershipMutationLocks } from '$lib/server/db/schema';
import { and, eq, lt } from 'drizzle-orm';
import {
	isLastAdmin,
	lastManagerMessage,
	listActiveHouseholdMemberships,
	membershipHasAdminRole
} from '$lib/server/household/members';

export type HouseholdMemberCommandResult =
	| { ok: true; message: string; clearHousehold?: boolean }
	| { ok: false; status: number; message: string };

const lockLeaseMilliseconds = 120_000;
const lockRenewalMilliseconds = 30_000;
const lockAcquireTimeoutMilliseconds = 5_000;
const lockRetryMilliseconds = 100;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const acquireMembershipMutationLock = async ({
	database,
	householdId
}: {
	database: D1Database;
	householdId: string;
}): Promise<string | null> => {
	const db = getDb(database);
	const ownerToken = crypto.randomUUID();
	const deadline = Date.now() + lockAcquireTimeoutMilliseconds;

	while (Date.now() < deadline) {
		const now = new Date().toISOString();
		await db
			.delete(householdMembershipMutationLocks)
			.where(
				and(
					eq(householdMembershipMutationLocks.householdId, householdId),
					lt(householdMembershipMutationLocks.expiresAt, now)
				)
			);

		const [lock] = await db
			.insert(householdMembershipMutationLocks)
			.values({
				householdId,
				ownerToken,
				expiresAt: new Date(Date.now() + lockLeaseMilliseconds).toISOString()
			})
			.onConflictDoNothing()
			.returning({ ownerToken: householdMembershipMutationLocks.ownerToken });
		if (lock) return ownerToken;

		await delay(lockRetryMilliseconds);
	}

	return null;
};

const renewMembershipMutationLock = async ({
	database,
	householdId,
	ownerToken
}: {
	database: D1Database;
	householdId: string;
	ownerToken: string;
}): Promise<boolean> => {
	const [lock] = await getDb(database)
		.update(householdMembershipMutationLocks)
		.set({
			expiresAt: new Date(Date.now() + lockLeaseMilliseconds).toISOString(),
			updatedAt: new Date().toISOString()
		})
		.where(
			and(
				eq(householdMembershipMutationLocks.householdId, householdId),
				eq(householdMembershipMutationLocks.ownerToken, ownerToken)
			)
		)
		.returning({ ownerToken: householdMembershipMutationLocks.ownerToken });

	return Boolean(lock);
};

const releaseMembershipMutationLock = async ({
	database,
	householdId,
	ownerToken
}: {
	database: D1Database;
	householdId: string;
	ownerToken: string;
}) => {
	await getDb(database)
		.delete(householdMembershipMutationLocks)
		.where(
			and(
				eq(householdMembershipMutationLocks.householdId, householdId),
				eq(householdMembershipMutationLocks.ownerToken, ownerToken)
			)
		);
};

const startMembershipMutationLockRenewal = ({
	database,
	householdId,
	ownerToken
}: {
	database: D1Database;
	householdId: string;
	ownerToken: string;
}) => {
	let renewing = true;
	let renewalError: Error | null = null;

	const done = (async () => {
		while (renewing) {
			await delay(lockRenewalMilliseconds);
			if (!renewing) break;
			const renewed = await renewMembershipMutationLock({ database, householdId, ownerToken });
			if (!renewed) {
				renewalError = new Error('Household membership mutation lock was lost.');
				renewing = false;
			}
		}

		return renewalError;
	})().catch((error: unknown) => {
		renewalError =
			error instanceof Error
				? error
				: new Error('Household membership mutation lock renewal failed.');
		return renewalError;
	});

	void done;

	return {
		stop: () => {
			renewing = false;
		},
		getError: () => renewalError
	};
};

type MembershipMutationContext = {
	ensureLockActive: () => Promise<boolean>;
};

const runSerializedMembershipMutation = async <T>({
	database,
	householdId,
	mutation,
	busyResult
}: {
	database: D1Database;
	householdId: string;
	mutation: (context: MembershipMutationContext) => Promise<T>;
	busyResult: T;
}): Promise<T> => {
	const ownerToken = await acquireMembershipMutationLock({ database, householdId });
	if (!ownerToken) return busyResult;

	const renewal = startMembershipMutationLockRenewal({ database, householdId, ownerToken });
	const ensureLockActive = async () => {
		if (renewal.getError()) return false;
		return renewMembershipMutationLock({ database, householdId, ownerToken });
	};

	try {
		return await mutation({ ensureLockActive });
	} finally {
		renewal.stop();
		await releaseMembershipMutationLock({ database, householdId, ownerToken });
		const renewalError = renewal.getError();
		if (renewalError) throw renewalError;
	}
};

export const updateMemberRoleFromForm = async ({
	platform,
	database,
	householdId,
	session,
	form
}: {
	platform: App.Platform | undefined;
	database: D1Database;
	householdId: string;
	session: AuthSession;
	form: FormData;
}): Promise<HouseholdMemberCommandResult> => {
	const membershipId = String(form.get('membershipId') ?? '').trim();
	const userId = String(form.get('userId') ?? '').trim();
	const roleSlug = householdRoleSlug(form.get('role'));
	if (!membershipId || !userId)
		return { ok: false, status: 400, message: 'Choose a member to update.' };

	return runSerializedMembershipMutation({
		database,
		householdId,
		busyResult: {
			ok: false,
			status: 409,
			message: 'Household membership is changing. Try again in a moment.'
		},
		mutation: async ({ ensureLockActive }) => {
			const runtime = createAuthRuntime(platform);
			const memberships = await listActiveHouseholdMemberships(platform, householdId);
			const actorMembership = memberships.find(
				(membership) => membership.userId === session.user.id
			);
			if (!actorMembership || !membershipHasAdminRole(actorMembership)) {
				return { ok: false, status: 403, message: 'Only household managers can update roles.' };
			}

			const membership =
				await runtime.workos.userManagement.getOrganizationMembership(membershipId);
			if (membership.organizationId !== householdId || membership.userId !== userId) {
				return { ok: false, status: 404, message: 'Household member not found.' };
			}
			if (membership.directoryManaged) {
				return {
					ok: false,
					status: 400,
					message: 'Directory-managed member roles must be changed in the identity provider.'
				};
			}
			if (userId === session.user.id && roleSlug !== 'admin') {
				return { ok: false, status: 400, message: 'You cannot remove your own manager access.' };
			}

			const adminCount = memberships.filter(membershipHasAdminRole).length;
			if (
				roleSlug !== 'admin' &&
				isLastAdmin({ isAdmin: membershipHasAdminRole(membership), adminCount })
			) {
				return { ok: false, status: 400, message: lastManagerMessage };
			}
			if (!(await ensureLockActive())) {
				return {
					ok: false,
					status: 409,
					message: 'Household membership is changing. Try again in a moment.'
				};
			}

			await runtime.workos.userManagement.updateOrganizationMembership(membershipId, { roleSlug });
			return { ok: true, message: 'Member role updated.' };
		}
	});
};

export const leaveHouseholdMembership = async ({
	platform,
	database,
	householdId,
	session
}: {
	platform: App.Platform | undefined;
	database: D1Database;
	householdId: string;
	session: AuthSession;
}): Promise<HouseholdMemberCommandResult> =>
	runSerializedMembershipMutation({
		database,
		householdId,
		busyResult: {
			ok: false,
			status: 409,
			message: 'Household membership is changing. Try again in a moment.'
		},
		mutation: async ({ ensureLockActive }) => {
			const runtime = createAuthRuntime(platform);
			const memberships = await listActiveHouseholdMemberships(platform, householdId);
			const currentMembership = memberships.find(
				(membership) => membership.userId === session.user.id
			);
			if (!currentMembership)
				return { ok: false, status: 404, message: 'Household member not found.' };
			if (currentMembership.directoryManaged) {
				return {
					ok: false,
					status: 400,
					message: 'Directory-managed members must leave through the identity provider.'
				};
			}

			const adminCount = memberships.filter(membershipHasAdminRole).length;
			if (isLastAdmin({ isAdmin: membershipHasAdminRole(currentMembership), adminCount })) {
				return { ok: false, status: 400, message: lastManagerMessage };
			}
			if (!(await ensureLockActive())) {
				return {
					ok: false,
					status: 409,
					message: 'Household membership is changing. Try again in a moment.'
				};
			}

			await runtime.workos.userManagement.deleteOrganizationMembership(currentMembership.id);
			return { ok: true, message: 'Household left.', clearHousehold: true };
		}
	});

export const removeMemberFromForm = async ({
	platform,
	database,
	householdId,
	session,
	form
}: {
	platform: App.Platform | undefined;
	database: D1Database;
	householdId: string;
	session: AuthSession;
	form: FormData;
}): Promise<HouseholdMemberCommandResult> => {
	const membershipId = String(form.get('membershipId') ?? '');
	const userId = String(form.get('userId') ?? '');
	if (!membershipId || !userId)
		return { ok: false, status: 400, message: 'Choose a member to remove.' };
	if (userId === session.user.id)
		return { ok: false, status: 400, message: 'You cannot remove yourself.' };

	return runSerializedMembershipMutation({
		database,
		householdId,
		busyResult: {
			ok: false,
			status: 409,
			message: 'Household membership is changing. Try again in a moment.'
		},
		mutation: async ({ ensureLockActive }) => {
			const runtime = createAuthRuntime(platform);
			const memberships = await listActiveHouseholdMemberships(platform, householdId);
			const actorMembership = memberships.find(
				(membership) => membership.userId === session.user.id
			);
			if (!actorMembership || !membershipHasAdminRole(actorMembership)) {
				return { ok: false, status: 403, message: 'Only household managers can remove members.' };
			}

			const membership =
				await runtime.workos.userManagement.getOrganizationMembership(membershipId);
			if (membership.organizationId !== householdId || membership.userId !== userId) {
				return { ok: false, status: 404, message: 'Household member not found.' };
			}
			if (membership.directoryManaged) {
				return {
					ok: false,
					status: 400,
					message: 'Directory-managed members must be removed in the identity provider.'
				};
			}
			const adminCount = memberships.filter(membershipHasAdminRole).length;
			if (isLastAdmin({ isAdmin: membershipHasAdminRole(membership), adminCount })) {
				return { ok: false, status: 400, message: lastManagerMessage };
			}
			if (!(await ensureLockActive())) {
				return {
					ok: false,
					status: 409,
					message: 'Household membership is changing. Try again in a moment.'
				};
			}

			await runtime.workos.userManagement.deleteOrganizationMembership(membershipId);
			return { ok: true, message: 'Member removed.' };
		}
	});
};
