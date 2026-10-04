import { handleUserSyncRequest } from '$lib/server/sync/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => handleUserSyncRequest(event, 'push');
