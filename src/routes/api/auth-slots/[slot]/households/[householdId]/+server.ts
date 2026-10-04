import { handleHouseholdAdministrationRequest } from '$lib/server/household-administration/index.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	handleHouseholdAdministrationRequest(event, 'refreshHousehold');
