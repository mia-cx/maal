import { households, users } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';

interface ProvisionableSession {
	user: { id: string };
	organizationId?: string | null;
	createdByUserId?: string | null;
}

export const provisionAuthSession = async (
	platform: App.Platform | undefined,
	session: ProvisionableSession
): Promise<void> => {
	if (!platform?.env.DB) return;

	const db = getDb(platform.env.DB);

	await db.insert(users).values({ workosUserId: session.user.id }).onConflictDoNothing();

	if (!session.organizationId) return;

	await db
		.insert(households)
		.values({
			householdId: session.organizationId,
			createdByUserId: session.createdByUserId ?? null
		})
		.onConflictDoNothing();
};
