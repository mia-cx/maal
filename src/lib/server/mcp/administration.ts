import type {
	HouseholdInviteSummary,
	HouseholdRole,
	Membership
} from '$lib/domain/household/contracts.js';
import { createInviteCode, type InviteExpiryDays } from '$lib/domain/household/invites.js';
import { createWorkOSHouseholdIdentityAdapter } from '$lib/server/household-administration/identity.js';
import { HouseholdAdministrationRepository } from '$lib/server/household-administration/repository.js';
import { HouseholdAdministrationService } from '$lib/server/household-administration/service.js';

import type { McpPrincipal } from './contracts.js';

export interface McpHouseholdAdministrationPort {
	createInvite(input: {
		householdId: string;
		roleSlug: HouseholdRole;
		expiresInDays: InviteExpiryDays;
		maxUses: number | null;
	}): Promise<{ readonly code: string; readonly invite: HouseholdInviteSummary }>;
	revokeInvite(householdId: string, inviteId: string): Promise<HouseholdInviteSummary>;
	updateMemberRole(
		householdId: string,
		membershipId: string,
		roleSlug: HouseholdRole
	): Promise<Membership>;
	removeMember(householdId: string, membershipId: string): Promise<void>;
}

export const createMcpHouseholdAdministrationPort = (
	principal: McpPrincipal,
	environment: Env
): McpHouseholdAdministrationPort => {
	const service = new HouseholdAdministrationService(
		new HouseholdAdministrationRepository(environment.DB),
		createWorkOSHouseholdIdentityAdapter(environment)
	);
	const actor = {
		authSlotId: principal.keyId,
		workosUserId: principal.ownerUserId,
		activeOrganizationIds: principal.effectiveHouseholds.map(({ householdId }) => householdId)
	};
	return {
		async createInvite(input) {
			const code = createInviteCode();
			const invite = await service.createInvite({
				actor,
				householdId: input.householdId,
				request: { ...input, code }
			});
			return { code, invite };
		},
		revokeInvite: (householdId, inviteId) => service.revokeInvite({ actor, householdId, inviteId }),
		updateMemberRole: (householdId, membershipId, roleSlug) =>
			service.updateMemberRole({ actor, householdId, membershipId, roleSlug }),
		removeMember: (householdId, membershipId) =>
			service.removeMember({ actor, householdId, membershipId })
	};
};
