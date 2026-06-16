import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { householdInvites } from '$lib/server/db/schema';
import { commitHouseholdCookie } from './household';
import { provisionAuthSession } from './provisioning';
import { createAuthRuntime } from './workos';

const inviteCodeBytes = 12;
const inviteCodeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const householdRoleSlugs = ['admin', 'member', 'child'] as const;
export type HouseholdRoleSlug = (typeof householdRoleSlugs)[number];
const defaultMemberRole: HouseholdRoleSlug = 'member';

export type HouseholdInvite = typeof householdInvites.$inferSelect;

export const householdRoleSlug = (value: FormDataEntryValue | null): HouseholdRoleSlug =>
	typeof value === 'string' && householdRoleSlugs.includes(value as HouseholdRoleSlug)
		? (value as HouseholdRoleSlug)
		: defaultMemberRole;

const randomInviteCode = (): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(inviteCodeBytes));
	return Array.from(bytes, (byte) => inviteCodeAlphabet[byte % inviteCodeAlphabet.length]).join('');
};

export const inviteExpired = (invite: Pick<HouseholdInvite, 'expiresAt'>): boolean =>
	Boolean(invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now());

export const inviteExhausted = (invite: Pick<HouseholdInvite, 'maxUses' | 'usesCount'>): boolean =>
	invite.maxUses !== null && invite.usesCount >= invite.maxUses;

export const inviteUsable = (
	invite: Pick<HouseholdInvite, 'revokedAt' | 'expiresAt' | 'maxUses' | 'usesCount'>
): boolean => !invite.revokedAt && !inviteExpired(invite) && !inviteExhausted(invite);

export const listHouseholdInvites = async (
	database: D1Database,
	householdId: string
): Promise<HouseholdInvite[]> =>
	getDb(database)
		.select()
		.from(householdInvites)
		.where(eq(householdInvites.householdId, householdId))
		.orderBy(desc(householdInvites.createdAt));

export const createHouseholdInvite = async (input: {
	database: D1Database;
	householdId: string;
	createdByUserId: string;
	roleSlug?: HouseholdRoleSlug;
	maxUses?: number | null;
	expiresAt?: string | null;
}): Promise<HouseholdInvite> => {
	const db = getDb(input.database);

	for (let attempt = 0; attempt < 5; attempt += 1) {
		const id = crypto.randomUUID();
		const code = randomInviteCode();
		try {
			await db.insert(householdInvites).values({
				id,
				householdId: input.householdId,
				code,
				createdByUserId: input.createdByUserId,
				roleSlug: input.roleSlug ?? defaultMemberRole,
				maxUses: input.maxUses ?? null,
				expiresAt: input.expiresAt ?? null
			});
			const [invite] = await db
				.select()
				.from(householdInvites)
				.where(eq(householdInvites.id, id))
				.limit(1);
			if (invite) return invite;
		} catch (cause) {
			if (attempt === 4) throw cause;
		}
	}

	throw new Error('Could not create household invite.');
};

export const updateHouseholdInviteRole = async (input: {
	database: D1Database;
	householdId: string;
	inviteId: string;
	roleSlug: HouseholdRoleSlug;
}): Promise<number> => {
	const rows = await getDb(input.database)
		.update(householdInvites)
		.set({ roleSlug: input.roleSlug })
		.where(
			and(
				eq(householdInvites.id, input.inviteId),
				eq(householdInvites.householdId, input.householdId)
			)
		)
		.returning({ id: householdInvites.id });
	return rows.length;
};

export const revokeHouseholdInvite = async (input: {
	database: D1Database;
	householdId: string;
	inviteId: string;
}): Promise<number> => {
	const rows = await getDb(input.database)
		.update(householdInvites)
		.set({ revokedAt: new Date().toISOString() })
		.where(
			and(
				eq(householdInvites.id, input.inviteId),
				eq(householdInvites.householdId, input.householdId)
			)
		)
		.returning({ id: householdInvites.id });
	return rows.length;
};

export const deleteHouseholdInvite = async (input: {
	database: D1Database;
	householdId: string;
	inviteId: string;
}): Promise<number> => {
	const rows = await getDb(input.database)
		.delete(householdInvites)
		.where(
			and(
				eq(householdInvites.id, input.inviteId),
				eq(householdInvites.householdId, input.householdId)
			)
		)
		.returning({ id: householdInvites.id });
	return rows.length;
};

export const loadHouseholdInviteByCode = async (
	database: D1Database,
	code: string
): Promise<HouseholdInvite | null> => {
	const [invite] = await getDb(database)
		.select()
		.from(householdInvites)
		.where(and(eq(householdInvites.code, code), isNull(householdInvites.revokedAt)))
		.limit(1);
	return invite && inviteUsable(invite) ? invite : null;
};

export const joinHouseholdFromInvite = async (input: {
	platform: App.Platform;
	cookies: Cookies;
	url: URL;
	code: string;
	userId: string;
}): Promise<string> => {
	const invite = await loadHouseholdInviteByCode(input.platform.env.DB, input.code);
	if (!invite) throw new Error('Invite not found.');

	const runtime = createAuthRuntime(input.platform);
	const memberships = await runtime.workos.userManagement.listOrganizationMemberships({
		organizationId: invite.householdId,
		userId: input.userId,
		statuses: ['active'],
		limit: 1
	});

	if (!memberships.data[0]) {
		await runtime.workos.userManagement.createOrganizationMembership({
			organizationId: invite.householdId,
			userId: input.userId,
			roleSlug: householdRoleSlug(invite.roleSlug)
		});
		await getDb(input.platform.env.DB)
			.update(householdInvites)
			.set({ usesCount: sql`${householdInvites.usesCount} + 1` })
			.where(eq(householdInvites.id, invite.id));
	}

	await provisionAuthSession(input.platform, {
		user: { id: input.userId },
		organizationId: invite.householdId
	});
	commitHouseholdCookie(input.cookies, invite.householdId, input.url);
	return invite.householdId;
};
