import { handleHouseholdAdministrationRequest } from '$lib/server/household-administration/index.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = (event) =>
	handleHouseholdAdministrationRequest(event, 'updateMemberRole');

export const DELETE: RequestHandler = (event) =>
	handleHouseholdAdministrationRequest(event, 'removeMember');
