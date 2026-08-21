<script lang="ts">
	import {
		createHouseholdTaxonomyEditorLiveQuery,
		emptyHouseholdTaxonomyEditorView,
		saveHouseholdDisplayOverrides,
		type HouseholdTaxonomyEditorView,
		type SaveHouseholdDisplayOverridesInput
	} from '$lib/client/taxonomy/index.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';

	import TaxonomyPreferencesForm from './taxonomy-preferences-form.svelte';

	let {
		database,
		authSlotId,
		originDeviceId,
		workosUserId,
		householdId,
		locale,
		canManageHousehold,
		onerror
	}: {
		database: MaalDatabase;
		authSlotId: string;
		originDeviceId: string;
		workosUserId: string;
		householdId: string;
		locale: string;
		canManageHousehold: boolean;
		onerror?: (error: unknown) => void;
	} = $props();

	let view = $state<HouseholdTaxonomyEditorView>(emptyHouseholdTaxonomyEditorView());
	let saving = $state(false);
	$effect(() => {
		const subscription = createHouseholdTaxonomyEditorLiveQuery(database, {
			workosUserId,
			householdId,
			locale
		}).subscribe((value) => (view = value));
		return subscription;
	});

	const save = async (input: SaveHouseholdDisplayOverridesInput) => {
		saving = true;
		try {
			await saveHouseholdDisplayOverrides(
				{ database, authSlotId, originDeviceId },
				{ workosUserId, householdId, locale },
				input
			);
		} catch (error) {
			onerror?.(error);
		} finally {
			saving = false;
		}
	};
</script>

<TaxonomyPreferencesForm {view} {canManageHousehold} {saving} onsave={save} />
