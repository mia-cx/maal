<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import SearchCombobox from '$lib/components/ui/search-combobox.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { cn } from '$lib/utils.js';
	import { untrack } from 'svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let householdName = $state(untrack(() => data.household.name));
	let defaultServings = $state(untrack(() => String(data.profile.defaultServings)));
	let locale = $state(untrack(() => data.profile.locale));
	let timezone = $state(untrack(() => data.profile.timezone ?? ''));

	let weekStartsOn = $state(untrack(() => data.profile.weekStartsOn));
	let preferredMassUnit = $state(untrack(() => data.profile.preferredMassUnit));
	let preferredVolumeUnit = $state(untrack(() => data.profile.preferredVolumeUnit));
	const initialPreferredTemperatureUnit = untrack(
		() =>
			data.profile.preferredTemperatureUnit ??
			data.taxonomyOptions.temperaturePresetOptions[0]?.value ??
			''
	);
	let preferredTemperatureUnit = $state(initialPreferredTemperatureUnit);
	let preferredDinnerTime = $state(untrack(() => data.profile.preferredDinnerTime ?? ''));
	let appliances = $state(
		untrack(() =>
			data.appliances.map((appliance) => ({
				...appliance,
				notes: appliance.notes ?? ''
			}))
		)
	);
	let removeMemberDialogOpen = $state(false);
	let memberToRemove = $state<{ id: string; userId: string; name: string } | null>(null);
	let deleteHouseholdFirstOpen = $state(false);
	let deleteHouseholdSecondOpen = $state(false);

	const canManageHousehold = $derived(data.canManageHousehold);
	const fieldDisabled = $derived(!canManageHousehold);
	const weekStartLabels = {
		sunday: 'Sunday',
		monday: 'Monday'
	};
	const localeOptions = [
		{ value: 'en', label: 'English', keywords: ['english'] },
		{ value: 'en-US', label: 'English (United States)', keywords: ['english', 'us', 'usa'] },
		{ value: 'en-GB', label: 'English (United Kingdom)', keywords: ['english', 'uk', 'gb'] },
		{ value: 'nl', label: 'Dutch', keywords: ['dutch', 'nederlands'] },
		{ value: 'nl-NL', label: 'Dutch (Netherlands)', keywords: ['dutch', 'nederlands'] },
		{ value: 'fr', label: 'French', keywords: ['french', 'français'] },
		{ value: 'fr-FR', label: 'French (France)', keywords: ['french', 'français'] },
		{ value: 'fr-CA', label: 'French (Canada)', keywords: ['french', 'canada', 'québec'] },
		{ value: 'de', label: 'German', keywords: ['german', 'deutsch'] },
		{ value: 'de-DE', label: 'German (Germany)', keywords: ['german', 'deutsch'] },
		{ value: 'es', label: 'Spanish', keywords: ['spanish', 'español'] },
		{ value: 'es-ES', label: 'Spanish (Spain)', keywords: ['spanish', 'español'] },
		{ value: 'es-MX', label: 'Spanish (Mexico)', keywords: ['spanish', 'mexico', 'español'] },
		{ value: 'it-IT', label: 'Italian (Italy)', keywords: ['italian', 'italiano'] },
		{ value: 'pt-BR', label: 'Portuguese (Brazil)', keywords: ['portuguese', 'brazil'] }
	];
	const timezoneOptions = ['UTC', ...Intl.supportedValuesOf('timeZone')].map((timezone) => ({
		value: timezone,
		label: timezone.replaceAll('_', ' '),
		keywords: timezone.split(/[/_]/)
	}));
	type UnitOverrideRow = { id: string; baseUnit: string; preferredUnitAlias: string };
	type IngredientOverrideRow = {
		id: string;
		baseFood: string;
		preferredFoodAlias: string;
		preferredMeasureUnit: string;
	};
	const serializeUnitOverrideRows = (rows: UnitOverrideRow[]) =>
		JSON.stringify(
			rows
				.map(({ baseUnit, preferredUnitAlias }) => ({
					baseUnit: baseUnit.trim(),
					preferredUnitAlias: preferredUnitAlias.trim()
				}))
				.filter((row) => row.baseUnit || row.preferredUnitAlias)
		);
	const serializeIngredientOverrideRows = (rows: IngredientOverrideRow[]) =>
		JSON.stringify(
			rows
				.map(({ baseFood, preferredFoodAlias, preferredMeasureUnit }) => ({
					baseFood: baseFood.trim(),
					preferredFoodAlias: preferredFoodAlias.trim(),
					preferredMeasureUnit: preferredMeasureUnit.trim()
				}))
				.filter((row) => row.baseFood || row.preferredFoodAlias || row.preferredMeasureUnit)
		);
	const initialUnitOverrideRows = untrack(() =>
		serializeUnitOverrideRows(data.displayOverrideRows.unitOverrides)
	);
	const initialIngredientOverrideRows = untrack(() =>
		serializeIngredientOverrideRows(data.displayOverrideRows.ingredientOverrides)
	);
	let nextOverrideRowId = 0;
	let unitOverrideRows = $state<UnitOverrideRow[]>(
		untrack(() => data.displayOverrideRows.unitOverrides)
	);
	let ingredientOverrideRows = $state<IngredientOverrideRow[]>(
		untrack(() => data.displayOverrideRows.ingredientOverrides)
	);
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

	const householdNameChanged = $derived(householdName.trim() !== data.household.name);
	const defaultServingsChanged = $derived(defaultServings !== String(data.profile.defaultServings));
	const localeChanged = $derived(locale.trim() !== data.profile.locale);
	const timezoneChanged = $derived(timezone.trim() !== (data.profile.timezone ?? ''));
	const weekStartsOnChanged = $derived(weekStartsOn !== data.profile.weekStartsOn);
	const preferredMassUnitChanged = $derived(preferredMassUnit !== data.profile.preferredMassUnit);
	const preferredVolumeUnitChanged = $derived(
		preferredVolumeUnit !== data.profile.preferredVolumeUnit
	);
	const preferredDinnerTimeChanged = $derived(
		preferredDinnerTime !== (data.profile.preferredDinnerTime ?? '')
	);
	const householdSettingsChanged = $derived(
		householdNameChanged ||
			defaultServingsChanged ||
			localeChanged ||
			timezoneChanged ||
			weekStartsOnChanged ||
			preferredDinnerTimeChanged
	);
	const temperatureUnitChanged = $derived(
		preferredTemperatureUnit !== initialPreferredTemperatureUnit
	);
	const unitOverrideRowsChanged = $derived(
		serializeUnitOverrideRows(unitOverrideRows) !== initialUnitOverrideRows
	);
	const ingredientOverrideRowsChanged = $derived(
		serializeIngredientOverrideRows(ingredientOverrideRows) !== initialIngredientOverrideRows
	);
	const aliasOverridesChanged = $derived(
		preferredMassUnitChanged ||
			preferredVolumeUnitChanged ||
			temperatureUnitChanged ||
			unitOverrideRowsChanged ||
			ingredientOverrideRowsChanged
	);
	const changedAppliances = $derived(
		appliances.filter((appliance) => {
			const initial = data.appliances.find((item) => item.appliance === appliance.appliance);
			return (
				initial &&
				(appliance.available !== initial.available || appliance.notes !== (initial.notes ?? ''))
			);
		})
	);
	const appliancesChanged = $derived(changedAppliances.length > 0);

	const promptMemberRemoval = (member: { id: string; userId: string; name: string }) => {
		memberToRemove = member;
		removeMemberDialogOpen = true;
	};
</script>

<svelte:head>
	<title>Household · Maal</title>
</svelte:head>

<div class="flex h-svh min-w-0 flex-col overflow-hidden bg-background text-foreground">
	<header
		class="sticky top-0 z-40 flex h-[52px] shrink-0 items-center border-b border-border bg-background px-2"
	>
		<div class="flex shrink-0 items-center gap-2 text-foreground">
			<div class="flex w-9 shrink-0 items-center justify-center">
				<Sidebar.Trigger />
			</div>
		</div>
	</header>

	<main class="min-h-0 flex-1 overflow-y-auto">
		<div class="mx-auto grid w-full max-w-4xl gap-6 px-4 py-5 md:px-6">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h1 class="text-xl font-semibold tracking-tight">Household settings</h1>
				{#if !canManageHousehold}
					<p class="text-xs text-muted-foreground">Read-only</p>
				{/if}
			</div>

			{#if form?.message}
				<p
					class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
				>
					{form.message}
				</p>
			{/if}

			<section class="grid gap-3 border-t border-border pt-4" aria-label="Basic settings">
				<form method="post" action="?/updateSettings" class="grid gap-4">
					<fieldset class="grid gap-3">
						<legend class="sr-only">Household</legend>
						<label class="grid min-w-0 gap-1 text-xs font-medium">
							Name
							<Input
								name={householdNameChanged ? 'name' : undefined}
								bind:value={householdName}
								maxlength={120}
								readonly={fieldDisabled}
								class="h-8 w-full"
							/>
						</label>
					</fieldset>

					<fieldset class="grid gap-3">
						<legend class="sr-only">Locale and calendar</legend>
						<div class="grid gap-3 md:grid-cols-3">
							<label class="grid min-w-0 gap-1 text-xs font-medium">
								Locale
								<SearchCombobox
									name={localeChanged ? 'locale' : undefined}
									bind:value={locale}
									options={localeOptions}
									disabled={fieldDisabled}
									placeholder="Select locale"
									searchPlaceholder="Search or type a BCP 47 locale..."
									allowCustom
									customOptionLabel={(input) => `Use custom locale “${input}”`}
								/>
							</label>
							<label class="grid min-w-0 gap-1 text-xs font-medium">
								Timezone
								<SearchCombobox
									name={timezoneChanged ? 'timezone' : undefined}
									bind:value={timezone}
									options={timezoneOptions}
									disabled={fieldDisabled}
									placeholder="Select timezone"
									searchPlaceholder="Search timezones..."
								/>
							</label>
							<label class="grid min-w-0 gap-1 text-xs font-medium">
								Start of week
								{#if weekStartsOnChanged}
									<input type="hidden" name="weekStartsOn" value={weekStartsOn} />
								{/if}
								<Select.Root type="single" bind:value={weekStartsOn} disabled={fieldDisabled}>
									<Select.Trigger class="!h-8 w-full">
										{weekStartLabels[weekStartsOn]}
									</Select.Trigger>
									<Select.Content>
										{#each Object.entries(weekStartLabels) as [value, label] (value)}
											<Select.Item {value}>{label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</label>
						</div>
					</fieldset>

					<fieldset class="grid gap-3">
						<legend class="sr-only">Meal defaults</legend>
						<div class="grid gap-3 md:grid-cols-2">
							<label class="grid min-w-0 gap-1 text-xs font-medium">
								Default yield
								<Input
									name={defaultServingsChanged ? 'defaultServings' : undefined}
									type="number"
									min="1"
									max="24"
									step="1"
									bind:value={defaultServings}
									readonly={fieldDisabled}
									class="h-8 w-full"
								/>
							</label>
							<label class="grid min-w-0 gap-1 text-xs font-medium">
								Preferred dinner time
								<Input
									name={preferredDinnerTimeChanged ? 'preferredDinnerTime' : undefined}
									type="time"
									bind:value={preferredDinnerTime}
									readonly={fieldDisabled}
									class="h-8 w-full"
								/>
							</label>
						</div>
					</fieldset>

					{#if canManageHousehold}
						<div>
							<Button type="submit" disabled={!householdSettingsChanged}>Save household</Button>
						</div>
					{/if}
				</form>
			</section>

			<section class="grid gap-3 border-t border-border pt-4">
				<h2 class="text-sm font-medium">Appliances</h2>
				<form method="post" action="?/updateAppliances" class="grid gap-3">
					{#each changedAppliances as appliance (appliance.appliance)}
						<input
							type="hidden"
							name={`available:${appliance.appliance}`}
							value={appliance.available ? 'on' : 'off'}
						/>
						<input type="hidden" name={`notes:${appliance.appliance}`} value={appliance.notes} />
					{/each}
					<div class="flex flex-wrap gap-2">
						{#each appliances as appliance (appliance.appliance)}
							<label
								class={cn(
									'inline-flex min-h-10 items-center rounded-xl border px-3 py-2 text-xs font-semibold shadow-sm transition-colors',
									appliance.available
										? 'border-primary bg-primary/10 text-foreground ring-2 ring-primary/30 hover:bg-primary/15'
										: 'border-border bg-muted/30 text-muted-foreground hover:border-foreground/30 hover:bg-muted/50',
									fieldDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
								)}
							>
								<input
									type="checkbox"
									bind:checked={appliance.available}
									disabled={fieldDisabled}
									class="sr-only"
								/>
								{appliance.label}
							</label>
						{/each}
					</div>
					{#if canManageHousehold}
						<div>
							<Button type="submit" disabled={!appliancesChanged}>Save appliances</Button>
						</div>
					{/if}
				</form>
			</section>

			<section
				class="grid gap-4 border-t border-border pt-4"
				aria-labelledby="aliases-overrides-title"
			>
				<h2 id="aliases-overrides-title" class="text-sm font-medium">Aliases & overrides</h2>
				<form method="post" action="?/updateSettings" class="grid gap-5">
					<input type="hidden" name="overrideLocale" value={locale} />
					<fieldset class="grid gap-3">
						<legend class="text-xs font-semibold text-muted-foreground">Units</legend>
						<div class="grid gap-3 md:grid-cols-3">
							<label class="grid min-w-0 gap-1 text-xs font-medium">
								Weight unit
								{#if preferredMassUnitChanged}
									<input type="hidden" name="preferredMassUnit" value={preferredMassUnit} />
								{/if}
								<SearchCombobox
									bind:value={preferredMassUnit}
									options={data.taxonomyOptions.weightPresetOptions}
									disabled={fieldDisabled}
									placeholder="Select weight unit"
									searchPlaceholder="Search weight units..."
								/>
							</label>
							<label class="grid min-w-0 gap-1 text-xs font-medium">
								Volume unit
								{#if preferredVolumeUnitChanged}
									<input type="hidden" name="preferredVolumeUnit" value={preferredVolumeUnit} />
								{/if}
								<SearchCombobox
									bind:value={preferredVolumeUnit}
									options={data.taxonomyOptions.volumePresetOptions}
									disabled={fieldDisabled}
									placeholder="Select volume unit"
									searchPlaceholder="Search volume units..."
								/>
							</label>
							<label class="grid min-w-0 gap-1 text-xs font-medium">
								Temperature unit
								{#if temperatureUnitChanged}
									<input
										type="hidden"
										name="preferredTemperatureUnit"
										value={preferredTemperatureUnit}
									/>
								{/if}
								<SearchCombobox
									bind:value={preferredTemperatureUnit}
									options={data.taxonomyOptions.temperaturePresetOptions}
									disabled={fieldDisabled}
									placeholder="Select temperature unit"
									searchPlaceholder="Search temperature units..."
								/>
							</label>
						</div>

						<input
							type="hidden"
							name="unitOverrides"
							value={serializeUnitOverrideRows(unitOverrideRows)}
						/>
						<div class="grid gap-2">
							{#each unitOverrideRows as override (override.id)}
								<div
									class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
								>
									<label class="grid min-w-0 gap-1 text-xs font-medium">
										Base unit
										<SearchCombobox
											bind:value={override.baseUnit}
											options={data.taxonomyOptions.baseUnitOptions}
											disabled={fieldDisabled}
											placeholder="base unit"
											searchPlaceholder="Search base units..."
										/>
									</label>
									<label class="grid min-w-0 gap-1 text-xs font-medium">
										Preferred alias
										<SearchCombobox
											bind:value={override.preferredUnitAlias}
											options={data.taxonomyOptions.unitAliasOptions}
											disabled={fieldDisabled}
											placeholder="alias"
											searchPlaceholder="Search unit aliases..."
											allowCustom
											customOptionLabel={(input) => `Use custom alias “${input}”`}
										/>
									</label>
									{#if canManageHousehold}
										<Button
											type="button"
											variant="ghost"
											onclick={() => removeUnitOverrideRow(override.id)}
										>
											Remove
										</Button>
									{/if}
								</div>
							{/each}
							{#if canManageHousehold}
								<div>
									<Button type="button" variant="outline" onclick={addUnitOverrideRow}>
										Add unit override
									</Button>
								</div>
							{/if}
						</div>
					</fieldset>

					<fieldset class="grid gap-3">
						<legend class="text-xs font-semibold text-muted-foreground">Ingredients</legend>
						<input
							type="hidden"
							name="ingredientOverrides"
							value={serializeIngredientOverrideRows(ingredientOverrideRows)}
						/>
						<div class="grid gap-2">
							{#each ingredientOverrideRows as override (override.id)}
								<div
									class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
								>
									<label class="grid min-w-0 gap-1 text-xs font-medium">
										Base food
										<SearchCombobox
											bind:value={override.baseFood}
											options={data.taxonomyOptions.foodOptions}
											disabled={fieldDisabled}
											placeholder="base food"
											searchPlaceholder="Search foods..."
										/>
									</label>
									<label class="grid min-w-0 gap-1 text-xs font-medium">
										Preferred alias
										<SearchCombobox
											bind:value={override.preferredFoodAlias}
											options={data.taxonomyOptions.foodAliasOptions}
											disabled={fieldDisabled}
											placeholder="alias"
											searchPlaceholder="Search food aliases..."
											allowCustom
											customOptionLabel={(input) => `Use custom alias “${input}”`}
										/>
									</label>
									<label class="grid min-w-0 gap-1 text-xs font-medium">
										Measure unit
										<SearchCombobox
											bind:value={override.preferredMeasureUnit}
											options={data.taxonomyOptions.measureUnitOptions}
											disabled={fieldDisabled}
											placeholder="unit"
											searchPlaceholder="Search measure units..."
										/>
									</label>
									{#if canManageHousehold}
										<Button
											type="button"
											variant="ghost"
											onclick={() => removeIngredientOverrideRow(override.id)}
										>
											Remove
										</Button>
									{/if}
								</div>
							{/each}
							{#if canManageHousehold}
								<div>
									<Button type="button" variant="outline" onclick={addIngredientOverrideRow}>
										Add ingredient override
									</Button>
								</div>
							{/if}
						</div>
					</fieldset>

					{#if canManageHousehold}
						<div>
							<Button type="submit" disabled={!aliasOverridesChanged}>Save overrides</Button>
						</div>
					{/if}
				</form>
			</section>

			<section class="grid gap-3 border-t border-border pt-4">
				<h2 class="text-sm font-medium">Members</h2>
				<div class="divide-y divide-border rounded-md border border-border">
					{#each data.members as member (member.id)}
						<div class="grid gap-3 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{member.name}</p>
								<p class="truncate text-xs text-muted-foreground">
									{member.email || member.userId}
								</p>
								<p class="text-xs text-muted-foreground">Role: {member.role}</p>
							</div>
							{#if member.userId === data.currentUserId}
								<span class="text-xs text-muted-foreground">You</span>
							{:else if member.directoryManaged}
								<span class="text-xs text-muted-foreground">Managed by IdP</span>
							{:else if canManageHousehold}
								<Button
									type="button"
									variant="destructive"
									size="sm"
									onclick={() => promptMemberRemoval(member)}
								>
									Remove
								</Button>
							{/if}
						</div>
					{/each}
				</div>
			</section>

			{#if Object.keys(data.household.metadata).length > 0}
				<section class="grid gap-3 border-t border-border pt-4">
					<h2 class="text-sm font-medium">Metadata</h2>
					<div class="grid gap-1 text-xs text-muted-foreground">
						{#each Object.entries(data.household.metadata) as [key, value] (key)}
							<p><span class="font-mono">{key}</span>: {value}</p>
						{/each}
					</div>
				</section>
			{/if}

			{#if canManageHousehold}
				<section class="grid gap-3 border-t border-border pt-4">
					<h2 class="text-sm font-medium">Danger zone</h2>
					<div>
						<Button
							type="button"
							variant="destructive"
							onclick={() => (deleteHouseholdFirstOpen = true)}
						>
							Delete household
						</Button>
					</div>
				</section>
			{/if}
		</div>
	</main>
</div>

<AlertDialog.Root bind:open={removeMemberDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove member?</AlertDialog.Title>
			<AlertDialog.Description>
				Remove {memberToRemove?.name ?? 'this member'} from this household.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			{#if memberToRemove}
				<form method="post" action="?/removeMember">
					<input type="hidden" name="membershipId" value={memberToRemove.id} />
					<input type="hidden" name="userId" value={memberToRemove.userId} />
					<Button type="submit" variant="destructive">Remove</Button>
				</form>
			{/if}
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteHouseholdFirstOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete household?</AlertDialog.Title>
			<AlertDialog.Description>
				This deletes the WorkOS organization and Maal household data for {data.household.name}.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<Button
				type="button"
				variant="destructive"
				onclick={() => {
					deleteHouseholdFirstOpen = false;
					deleteHouseholdSecondOpen = true;
				}}
			>
				Continue
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteHouseholdSecondOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Really delete household?</AlertDialog.Title>
			<AlertDialog.Description>
				This cannot be undone. Recipes saved to your menu stay, but household settings and planned
				meals are deleted.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<form method="post" action="?/deleteHousehold">
				<Button type="submit" variant="destructive">Delete household</Button>
			</form>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
