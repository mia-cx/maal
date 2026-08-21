<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import SearchCombobox from '$lib/components/ui/search-combobox.svelte';
	import type {
		HouseholdTaxonomyEditorView,
		SaveHouseholdDisplayOverridesInput
	} from '$lib/client/taxonomy/display-overrides.js';

	let {
		view,
		canManageHousehold,
		saving = false,
		onsave
	}: {
		view: HouseholdTaxonomyEditorView;
		canManageHousehold: boolean;
		saving?: boolean;
		onsave: (input: SaveHouseholdDisplayOverridesInput) => void | Promise<void>;
	} = $props();

	type UnitOverrideRow = { id: string; baseUnit: string; preferredUnitAlias: string };
	type IngredientOverrideRow = {
		id: string;
		baseFood: string;
		preferredFoodAlias: string;
		preferredMeasureUnit: string;
	};

	const cloneUnitRows = (rows: readonly UnitOverrideRow[]): UnitOverrideRow[] =>
		rows.map((row) => ({ ...row }));
	const cloneIngredientRows = (rows: readonly IngredientOverrideRow[]): IngredientOverrideRow[] =>
		rows.map((row) => ({ ...row }));
	const serializeUnitRows = (rows: readonly UnitOverrideRow[]): string =>
		JSON.stringify(
			rows.map(({ baseUnit, preferredUnitAlias }) => ({
				baseUnit: baseUnit.trim(),
				preferredUnitAlias: preferredUnitAlias.trim()
			}))
		);
	const serializeIngredientRows = (rows: readonly IngredientOverrideRow[]): string =>
		JSON.stringify(
			rows.map(({ baseFood, preferredFoodAlias, preferredMeasureUnit }) => ({
				baseFood: baseFood.trim(),
				preferredFoodAlias: preferredFoodAlias.trim(),
				preferredMeasureUnit: preferredMeasureUnit.trim()
			}))
		);

	let nextOverrideRowId = 0;
	let appliedView = $state<HouseholdTaxonomyEditorView | null>(null);
	let preferredMassUnit = $state('');
	let preferredVolumeUnit = $state('');
	let preferredTemperatureUnit = $state('');
	let unitOverrideRows = $state<UnitOverrideRow[]>([]);
	let ingredientOverrideRows = $state<IngredientOverrideRow[]>([]);
	let initialValues = $state('');

	const currentValues = () =>
		JSON.stringify({
			preferredMassUnit,
			preferredVolumeUnit,
			preferredTemperatureUnit,
			unitOverrides: serializeUnitRows(unitOverrideRows),
			ingredientOverrides: serializeIngredientRows(ingredientOverrideRows)
		});
	const applyView = (nextView: HouseholdTaxonomyEditorView) => {
		preferredMassUnit =
			nextView.displayOverrideRows.preferredMassUnit ??
			nextView.taxonomyOptions.weightPresetOptions[0]?.value ??
			'';
		preferredVolumeUnit =
			nextView.displayOverrideRows.preferredVolumeUnit ??
			nextView.taxonomyOptions.volumePresetOptions[0]?.value ??
			'';
		preferredTemperatureUnit =
			nextView.displayOverrideRows.preferredTemperatureUnit ??
			nextView.taxonomyOptions.temperaturePresetOptions[0]?.value ??
			'';
		unitOverrideRows = cloneUnitRows(nextView.displayOverrideRows.unitOverrides);
		ingredientOverrideRows = cloneIngredientRows(nextView.displayOverrideRows.ingredientOverrides);
		initialValues = currentValues();
	};

	$effect(() => {
		if (view !== appliedView && !saving) {
			appliedView = view;
			applyView(view);
		}
	});

	const changed = $derived(currentValues() !== initialValues);
	const fieldDisabled = $derived(!canManageHousehold || saving);
	const addUnitOverrideRow = () => {
		unitOverrideRows = [
			...unitOverrideRows,
			{ id: `unit-override-new-${nextOverrideRowId++}`, baseUnit: '', preferredUnitAlias: '' }
		];
	};
	const removeUnitOverrideRow = (id: string) => {
		unitOverrideRows = unitOverrideRows.filter((row) => row.id !== id);
	};
	const addIngredientOverrideRow = () => {
		ingredientOverrideRows = [
			...ingredientOverrideRows,
			{
				id: `ingredient-override-new-${nextOverrideRowId++}`,
				baseFood: '',
				preferredFoodAlias: '',
				preferredMeasureUnit: ''
			}
		];
	};
	const removeIngredientOverrideRow = (id: string) => {
		ingredientOverrideRows = ingredientOverrideRows.filter((row) => row.id !== id);
	};
	const submit = async (event: SubmitEvent) => {
		event.preventDefault();
		await onsave({
			preferredMassUnit,
			preferredVolumeUnit,
			preferredTemperatureUnit,
			unitOverrides: unitOverrideRows,
			ingredientOverrides: ingredientOverrideRows
		});
	};
</script>

<section class="grid gap-4 border-t border-border pt-4" aria-labelledby="aliases-overrides-title">
	<h2 id="aliases-overrides-title" class="text-sm font-medium">
		{m.household_aliases_overrides()}
	</h2>
	<form class="grid gap-5" onsubmit={submit}>
		<fieldset class="grid gap-3">
			<legend class="text-xs font-semibold text-muted-foreground">{m.household_units()}</legend>
			<div class="grid gap-3 md:grid-cols-3">
				<label class="grid min-w-0 gap-1 text-xs font-medium" data-testid="weight-unit">
					{m.household_weight_unit()}
					<SearchCombobox
						bind:value={preferredMassUnit}
						options={view.taxonomyOptions.weightPresetOptions}
						disabled={fieldDisabled}
						placeholder={m.household_select_weight_unit()}
						searchPlaceholder={m.household_search_units()}
					/>
				</label>
				<label class="grid min-w-0 gap-1 text-xs font-medium">
					{m.household_volume_unit()}
					<SearchCombobox
						bind:value={preferredVolumeUnit}
						options={view.taxonomyOptions.volumePresetOptions}
						disabled={fieldDisabled}
						placeholder={m.household_select_volume_unit()}
						searchPlaceholder={m.household_search_units()}
					/>
				</label>
				<label class="grid min-w-0 gap-1 text-xs font-medium">
					{m.household_temperature_unit()}
					<SearchCombobox
						bind:value={preferredTemperatureUnit}
						options={view.taxonomyOptions.temperaturePresetOptions}
						disabled={fieldDisabled}
						placeholder={m.household_select_temperature_unit()}
						searchPlaceholder={m.household_search_units()}
					/>
				</label>
			</div>

			<div class="grid gap-2">
				{#each unitOverrideRows as override (override.id)}
					<div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
						<label class="grid min-w-0 gap-1 text-xs font-medium">
							{m.household_base_unit()}
							<SearchCombobox
								bind:value={override.baseUnit}
								options={view.taxonomyOptions.baseUnitOptions}
								disabled={fieldDisabled}
								placeholder={m.household_base_unit_2()}
								searchPlaceholder={m.household_search_units()}
							/>
						</label>
						<label class="grid min-w-0 gap-1 text-xs font-medium">
							{m.household_preferred_alias()}
							<SearchCombobox
								bind:value={override.preferredUnitAlias}
								options={view.taxonomyOptions.unitAliasOptions}
								disabled={fieldDisabled}
								placeholder={m.household_alias_placeholder()}
								searchPlaceholder={m.household_search_units()}
								allowCustom
								customOptionLabel={(input) => `Use custom alias “${input}”`}
							/>
						</label>
						{#if canManageHousehold}
							<Button
								type="button"
								variant="ghost"
								disabled={saving}
								onclick={() => removeUnitOverrideRow(override.id)}
							>
								{m.menu_remove()}
							</Button>
						{/if}
					</div>
				{/each}
				{#if canManageHousehold}
					<div>
						<Button type="button" variant="outline" disabled={saving} onclick={addUnitOverrideRow}>
							{m.household_add_unit_override()}
						</Button>
					</div>
				{/if}
			</div>
		</fieldset>

		<fieldset class="grid gap-3">
			<legend class="text-xs font-semibold text-muted-foreground">{m.menu_ingredients()}</legend>
			<div class="grid gap-2">
				{#each ingredientOverrideRows as override (override.id)}
					<div
						class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
					>
						<label class="grid min-w-0 gap-1 text-xs font-medium">
							{m.household_base_food()}
							<SearchCombobox
								bind:value={override.baseFood}
								options={view.taxonomyOptions.foodOptions}
								disabled={fieldDisabled}
								placeholder={m.household_base_food_2()}
								searchPlaceholder={m.household_search_foods()}
							/>
						</label>
						<label class="grid min-w-0 gap-1 text-xs font-medium">
							{m.household_preferred_alias()}
							<SearchCombobox
								bind:value={override.preferredFoodAlias}
								options={view.taxonomyOptions.foodAliasOptions}
								disabled={fieldDisabled}
								placeholder={m.household_alias_placeholder()}
								searchPlaceholder={m.household_search_foods()}
								allowCustom
								customOptionLabel={(input) => `Use custom alias “${input}”`}
							/>
						</label>
						<label class="grid min-w-0 gap-1 text-xs font-medium">
							{m.household_measure_unit()}
							<SearchCombobox
								bind:value={override.preferredMeasureUnit}
								options={view.taxonomyOptions.measureUnitOptions}
								disabled={fieldDisabled}
								placeholder={m.household_unit_placeholder()}
								searchPlaceholder={m.household_search_units()}
							/>
						</label>
						{#if canManageHousehold}
							<Button
								type="button"
								variant="ghost"
								disabled={saving}
								onclick={() => removeIngredientOverrideRow(override.id)}
							>
								{m.menu_remove()}
							</Button>
						{/if}
					</div>
				{/each}
				{#if canManageHousehold}
					<div>
						<Button
							type="button"
							variant="outline"
							disabled={saving}
							onclick={addIngredientOverrideRow}
						>
							{m.household_add_ingredient_override()}
						</Button>
					</div>
				{/if}
			</div>
		</fieldset>

		{#if canManageHousehold}
			<div>
				<Button type="submit" disabled={!changed || saving}>{m.household_save_overrides()}</Button>
			</div>
		{/if}
	</form>
</section>
