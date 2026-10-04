import { Schema } from 'effect';
import type { RequestHandler } from './$types';

import { RecipeImportedCandidateSchema } from '$lib/domain/recipes/schema.js';
import { authenticateSyncSlot } from '$lib/server/sync/auth.js';
import { fetchRecipeCandidate } from '$lib/server/recipe-import/parser.js';
import {
	authorizeBrowserRecipeImport,
	consumeRecipeImportLimit
} from '$lib/server/recipe-import/remote-compute.js';

const ImportRequestSchema = Schema.Struct({
	householdId: Schema.String.pipe(Schema.minLength(1)),
	url: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2_048))
});

export const POST: RequestHandler = async (event) => {
	const environment = event.platform?.env;
	if (!environment?.DB || !environment.RECIPE_URL_RATE_LIMIT) {
		return Response.json({ error: 'remote_compute_unavailable' }, { status: 503 });
	}
	try {
		if (Number(event.request.headers.get('content-length') ?? 0) > 4_096) {
			return Response.json({ error: 'request_too_large' }, { status: 413 });
		}
		const request = Schema.decodeUnknownSync(ImportRequestSchema)(await event.request.json());
		const actor = await authenticateSyncSlot(event);
		const now = new Date().toISOString();
		await authorizeBrowserRecipeImport({
			database: environment.DB,
			actor,
			householdId: request.householdId,
			now
		});
		await consumeRecipeImportLimit({
			limiter: environment.RECIPE_URL_RATE_LIMIT,
			workosUserId: actor.workosUserId,
			householdId: request.householdId
		});
		const candidate = await fetchRecipeCandidate(request.url);
		return Response.json({
			schemaVersion: 1,
			candidate: Schema.encodeSync(RecipeImportedCandidateSchema)(candidate)
		});
	} catch (cause) {
		const tag = cause && typeof cause === 'object' && '_tag' in cause ? cause._tag : null;
		const status =
			tag === 'SyncUnauthenticated'
				? 401
				: tag === 'SyncCapabilityDenied' || tag === 'SyncPermissionDenied'
					? 403
					: tag === 'RemoteComputeRateLimited'
						? 429
						: 400;
		return Response.json({ error: tag ?? 'recipe_import_failed' }, { status });
	}
};
