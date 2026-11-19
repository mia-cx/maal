import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
import { activeHouseholdKey } from '$lib/client/local/profiles.js';
import { resolveLocalHouseholdSyncCapability } from '$lib/client/sync/household-capability.js';
import {
	RecipeImportedCandidateSchema,
	type RecipeAggregate,
	type RecipeImportedCandidate
} from '$lib/domain/recipes/schema.js';
import type { RecipeMenuItem } from '$lib/menu/menu-types.js';
import { mergeEditorIntoImportedCandidate } from '$lib/menu/recipe-local-adapter.js';
import * as m from '$lib/paraglide/messages';

import {
	commitImportedRecipeCandidate,
	updateRecipeFromImportedCandidate,
	type RecipeCommandContext
} from './commands.js';

const failureCopy = {
	plan_required: m.menu_url_import_requires_plan,
	sign_in_required: m.menu_url_import_sign_in,
	permission_denied: m.menu_url_import_no_permission,
	rate_limited: m.menu_url_import_rate_limited,
	page_unreachable: m.menu_url_import_page_unreachable,
	recipe_not_found: m.menu_url_import_no_recipe,
	unavailable: m.menu_url_import_unavailable
} satisfies Record<string, () => string>;

export type RecipeUrlImportFailure = keyof typeof failureCopy;

/** A URL import failure whose message is the localized copy the editor shows. */
export class RecipeUrlImportError extends Error {
	constructor(readonly reason: RecipeUrlImportFailure) {
		super(failureCopy[reason]());
	}
}

const ImportResponseSchema = Schema.Struct({
	schemaVersion: Schema.Literal(1),
	candidate: RecipeImportedCandidateSchema
});

const ErrorResponseSchema = Schema.Struct({ error: Schema.String });

const failureForResponse = (status: number, body: unknown): RecipeUrlImportFailure => {
	const tag = Schema.is(ErrorResponseSchema)(body) ? body.error : null;
	if (status === 401 || tag === 'SyncIdentityMismatch') return 'sign_in_required';
	if (tag === 'SyncCapabilityDenied') return 'plan_required';
	if (status === 403) return 'permission_denied';
	if (status === 429) return 'rate_limited';
	if (tag === 'RecipeImportFetchError') return 'page_unreachable';
	if (tag === 'RecipeImportParseError') return 'recipe_not_found';
	return 'unavailable';
};

/**
 * Asks the Worker to parse a recipe URL for the active profile's slot and household.
 * Free households, signed-out profiles, and read-only members fail locally without a request.
 * The returned candidate is not stored; confirm it with `confirmUrlImport` or
 * `commitImportedRecipeCandidate`.
 */
export const fetchRecipeUrlCandidate = async (
	database: MaalDatabase,
	url: string,
	fetcher: typeof fetch = globalThis.fetch
): Promise<RecipeImportedCandidate> => {
	const profileId = (await database.uiState.get('activeProfileId'))?.value;
	if (typeof profileId !== 'string') throw new RecipeUrlImportError('plan_required');
	const householdId = (await database.uiState.get(activeHouseholdKey(profileId)))?.value;
	const slot = await database.authSlots.where('profileId').equals(profileId).first();
	if (typeof householdId !== 'string' || !slot) throw new RecipeUrlImportError('plan_required');
	const capability = await resolveLocalHouseholdSyncCapability(
		database,
		slot.workosUserId,
		householdId
	);
	if (!capability.enabled) throw new RecipeUrlImportError('plan_required');
	if (!capability.permissions.includes('meals:write')) {
		throw new RecipeUrlImportError('permission_denied');
	}

	let response: Response;
	try {
		response = await fetcher(
			`/api/auth-slots/${encodeURIComponent(slot.authSlotId)}/recipes/import-url`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ householdId, url })
			}
		);
	} catch {
		throw new RecipeUrlImportError('unavailable');
	}
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) throw new RecipeUrlImportError(failureForResponse(response.status, body));
	try {
		return Schema.decodeUnknownSync(ImportResponseSchema)(body).candidate;
	} catch {
		throw new RecipeUrlImportError('unavailable');
	}
};

/**
 * Saves an imported candidate the user confirmed in the recipe editor. A new draft commits the
 * full candidate; an existing recipe keeps its ID and takes the edited fields.
 */
export const confirmUrlImport = (
	database: MaalDatabase,
	context: RecipeCommandContext,
	candidate: RecipeImportedCandidate,
	recipe: RecipeMenuItem
): Promise<RecipeAggregate> =>
	recipe.id.startsWith('draft-recipe-')
		? commitImportedRecipeCandidate(
				database,
				context,
				mergeEditorIntoImportedCandidate(candidate, recipe)
			)
		: updateRecipeFromImportedCandidate(
				database,
				context,
				recipe.id,
				mergeEditorIntoImportedCandidate(candidate, recipe)
			);
