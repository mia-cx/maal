import { createDecodedLiveQuery } from '$lib/client/local/live-query.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import {
	EffectiveTaxonomyPreferencesSchema,
	emptyTaxonomyPreferences
} from '$lib/taxonomy/preferences.js';

import { loadEffectiveTaxonomyPreferences } from './queries.js';

export const createTaxonomyPreferencesLiveQuery = (
	database: MaalDatabase,
	params: { workosUserId: string; householdId: string; locale: string }
) =>
	createDecodedLiveQuery({
		database,
		schema: EffectiveTaxonomyPreferencesSchema,
		initialValue: emptyTaxonomyPreferences(params.locale),
		query: () => loadEffectiveTaxonomyPreferences(database, params)
	});
