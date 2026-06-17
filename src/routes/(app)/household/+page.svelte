<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import DeleteConfirmDialog from '$lib/components/delete-confirm-dialog.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import SearchCombobox from '$lib/components/ui/search-combobox.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { cn } from '$lib/utils.js';
	import { untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';

	type InviteRow = {
		id: string;
		code: string;
		url: string;
		role: string;
		maxUses: number | null;
		usesCount: number;
		expiresAt: string | null;
		revokedAt: string | null;
		createdAt: string;
		usable: boolean;
	};
	type LocalPageData = Omit<PageData, 'invites' | 'freshView'> & {
		invites: InviteRow[];
		freshView?: Promise<LocalPageData>;
	};

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let view = $state<LocalPageData | null>(null);
	let freshViewVersion = 0;

	let initialView = untrack(() => data as LocalPageData);
	let householdName = $state(initialView.household.name);
	let defaultServings = $state(String(initialView.profile.defaultServings));
	let locale = $state(initialView.profile.locale);
	let timezone = $state(initialView.profile.timezone ?? '');

	let weekStartsOn = $state(initialView.profile.weekStartsOn);
	let preferredMassUnit = $state(initialView.profile.preferredMassUnit);
	let preferredVolumeUnit = $state(initialView.profile.preferredVolumeUnit);
	let initialPreferredTemperatureUnit = $state(
		initialView.profile.preferredTemperatureUnit ??
			initialView.taxonomyOptions.temperaturePresetOptions[0]?.value ??
			''
	);
	let preferredTemperatureUnit = $state(
		initialView.profile.preferredTemperatureUnit ??
			initialView.taxonomyOptions.temperaturePresetOptions[0]?.value ??
			''
	);
	let preferredDinnerTime = $state(initialView.profile.preferredDinnerTime ?? '');
	let appliances = $state(
		initialView.appliances.map((appliance) => ({
			...appliance,
			notes: appliance.notes ?? ''
		}))
	);
	let removeMemberDialogOpen = $state(false);
	let memberToRemove = $state<{ id: string; userId: string; name: string } | null>(null);
	let leaveHouseholdDialogOpen = $state(false);
	let deleteHouseholdFirstOpen = $state(false);
	let deleteHouseholdSecondOpen = $state(false);
	let inviteDialogOpen = $state(false);
	let inviteRole = $state('member');
	let inviteExpiresInDays = $state('7');
	let visibleInvites = $state<InviteRow[]>(initialView.invites);

	const currentView = $derived(view ?? initialView);

	$effect(() => {
		visibleInvites = currentView.invites;
	});

	const canManageHousehold = $derived(currentView.canManageHousehold);
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
	const cloneUnitOverrideRows = (rows: UnitOverrideRow[]) => rows.map((row) => ({ ...row }));
	const cloneIngredientOverrideRows = (rows: IngredientOverrideRow[]) =>
		rows.map((row) => ({ ...row }));
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
	let initialUnitOverrideRows = $state(
		untrack(() => serializeUnitOverrideRows(initialView.displayOverrideRows.unitOverrides))
	);
	let initialIngredientOverrideRows = $state(
		untrack(() =>
			serializeIngredientOverrideRows(initialView.displayOverrideRows.ingredientOverrides)
		)
	);
	let nextOverrideRowId = 0;
	let unitOverrideRows = $state<UnitOverrideRow[]>(
		untrack(() => cloneUnitOverrideRows(initialView.displayOverrideRows.unitOverrides))
	);
	let ingredientOverrideRows = $state<IngredientOverrideRow[]>(
		untrack(() => cloneIngredientOverrideRows(initialView.displayOverrideRows.ingredientOverrides))
	);
	const applyHouseholdView = (nextView: LocalPageData) => {
		const { freshView: _freshView, ...resolvedView } = nextView;
		view = resolvedView;
		householdName = nextView.household.name;
		defaultServings = String(nextView.profile.defaultServings);
		locale = nextView.profile.locale;
		timezone = nextView.profile.timezone ?? '';
		weekStartsOn = nextView.profile.weekStartsOn;
		preferredMassUnit = nextView.profile.preferredMassUnit;
		preferredVolumeUnit = nextView.profile.preferredVolumeUnit;
		initialPreferredTemperatureUnit =
			nextView.profile.preferredTemperatureUnit ??
			nextView.taxonomyOptions.temperaturePresetOptions[0]?.value ??
			'';
		preferredTemperatureUnit = initialPreferredTemperatureUnit;
		preferredDinnerTime = nextView.profile.preferredDinnerTime ?? '';
		appliances = nextView.appliances.map((appliance) => ({
			...appliance,
			notes: appliance.notes ?? ''
		}));
		initialUnitOverrideRows = serializeUnitOverrideRows(nextView.displayOverrideRows.unitOverrides);
		initialIngredientOverrideRows = serializeIngredientOverrideRows(
			nextView.displayOverrideRows.ingredientOverrides
		);
		unitOverrideRows = cloneUnitOverrideRows(nextView.displayOverrideRows.unitOverrides);
		ingredientOverrideRows = cloneIngredientOverrideRows(
			nextView.displayOverrideRows.ingredientOverrides
		);
		visibleInvites = nextView.invites;
	};

	$effect(() => {
		const nextVersion = ++freshViewVersion;
		view = data as LocalPageData;
		if ('freshView' in data && data.freshView) {
			void Promise.resolve(data.freshView)
				.then((freshView) => {
					if (nextVersion !== freshViewVersion) return;
					applyHouseholdView(freshView as LocalPageData);
				})
				.catch((cause) => {
					if (nextVersion !== freshViewVersion) return;
					console.error('Failed to refresh household view', cause);
				});
		}
	});
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

	const householdNameChanged = $derived(householdName.trim() !== currentView.household.name);
	const defaultServingsChanged = $derived(
		defaultServings !== String(currentView.profile.defaultServings)
	);
	const localeChanged = $derived(locale.trim() !== currentView.profile.locale);
	const timezoneChanged = $derived(timezone.trim() !== (currentView.profile.timezone ?? ''));
	const weekStartsOnChanged = $derived(weekStartsOn !== currentView.profile.weekStartsOn);
	const preferredMassUnitChanged = $derived(
		preferredMassUnit !== currentView.profile.preferredMassUnit
	);
	const preferredVolumeUnitChanged = $derived(
		preferredVolumeUnit !== currentView.profile.preferredVolumeUnit
	);
	const preferredDinnerTimeChanged = $derived(
		preferredDinnerTime !== (currentView.profile.preferredDinnerTime ?? '')
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
			const initial = currentView.appliances.find((item) => item.appliance === appliance.appliance);
			return (
				initial &&
				(appliance.available !== initial.available || appliance.notes !== (initial.notes ?? ''))
			);
		})
	);
	const appliancesChanged = $derived(changedAppliances.length > 0);
	const roleOptions = [
		{ value: 'admin', label: 'Manager' },
		{ value: 'member', label: 'Adult' },
		{ value: 'child', label: 'Child' }
	] as const;
	const roleLabel = (role: string): string =>
		roleOptions.find((option) => option.value === role)?.label ?? role;
	const formatInviteExpiry = (expiresAt: string | null) =>
		expiresAt ? new Date(expiresAt).toLocaleDateString() : 'No expiry';
	const inviteUsageLabel = (invite: { usesCount: number; maxUses: number | null }) =>
		invite.maxUses === null
			? `${invite.usesCount} used`
			: `${invite.usesCount}/${invite.maxUses} used`;

	const deleteInviteEnhance =
		(inviteId: string): SubmitFunction =>
		() => {
			const previousInvites = visibleInvites;
			visibleInvites = visibleInvites.filter((invite) => invite.id !== inviteId);
			return async ({ result }) => {
				if (result.type !== 'success') visibleInvites = previousInvites;
			};
		};

	const revokeInviteEnhance =
		(inviteId: string): SubmitFunction =>
		() => {
			const previousInvites = visibleInvites;
			const revokedAt = new Date().toISOString();
			visibleInvites = visibleInvites.map((invite) =>
				invite.id === inviteId ? { ...invite, revokedAt, usable: false } : invite
			);
			return async ({ result }) => {
				if (result.type !== 'success') visibleInvites = previousInvites;
			};
		};

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
									options={currentView.taxonomyOptions.weightPresetOptions}
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
									options={currentView.taxonomyOptions.volumePresetOptions}
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
									options={currentView.taxonomyOptions.temperaturePresetOptions}
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
											options={currentView.taxonomyOptions.baseUnitOptions}
											disabled={fieldDisabled}
											placeholder="base unit"
											searchPlaceholder="Search base units..."
										/>
									</label>
									<label class="grid min-w-0 gap-1 text-xs font-medium">
										Preferred alias
										<SearchCombobox
											bind:value={override.preferredUnitAlias}
											options={currentView.taxonomyOptions.unitAliasOptions}
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
											options={currentView.taxonomyOptions.foodOptions}
											disabled={fieldDisabled}
											placeholder="base food"
											searchPlaceholder="Search foods..."
										/>
									</label>
									<label class="grid min-w-0 gap-1 text-xs font-medium">
										Preferred alias
										<SearchCombobox
											bind:value={override.preferredFoodAlias}
											options={currentView.taxonomyOptions.foodAliasOptions}
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
											options={currentView.taxonomyOptions.measureUnitOptions}
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
				<div class="grid gap-1">
					<h2 class="text-sm font-medium">Members</h2>
					<p class="text-xs text-muted-foreground">
						Manage who can access {currentView.household.name} and what role new invitees receive.
					</p>
				</div>

				<div class="divide-y divide-border rounded-md border border-border">
					{#each currentView.members as member (member.id)}
						<div class="grid gap-3 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{member.name}</p>
								<p class="truncate text-xs text-muted-foreground">
									{member.email || member.userId}
								</p>
							</div>
							<div class="flex items-center justify-end gap-2">
								{#if canManageHousehold && !member.directoryManaged && member.userId !== currentView.currentUserId}
									<form method="post" action="?/updateMemberRole" class="contents">
										<input type="hidden" name="membershipId" value={member.id} />
										<input type="hidden" name="userId" value={member.userId} />
										<select
											name="role"
											class="h-8 rounded-md border border-input bg-background px-2 text-xs"
											onchange={(event) => event.currentTarget.form?.requestSubmit()}
										>
											{#each roleOptions as role (role.value)}
												<option value={role.value} selected={member.role === role.value}
													>{role.label}</option
												>
											{/each}
										</select>
									</form>
								{:else}
									<span class="text-xs text-muted-foreground">{roleLabel(member.role)}</span>
								{/if}

								{#if member.userId === currentView.currentUserId}
									<span class="text-xs text-muted-foreground">You</span>
								{:else if member.directoryManaged}
									<span class="text-xs text-muted-foreground">Managed by IdP</span>
								{/if}

								{#if canManageHousehold && !member.directoryManaged}
									<DropdownMenu.Root>
										<DropdownMenu.Trigger
											class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
											aria-label={`Actions for ${member.name}`}
										>
											<EllipsisIcon class="size-4" />
										</DropdownMenu.Trigger>
										<DropdownMenu.Content align="end" class="w-36">
											<DropdownMenu.Item
												disabled={member.userId === currentView.currentUserId}
												onclick={() => {
													if (member.userId !== currentView.currentUserId)
														promptMemberRemoval(member);
												}}
												variant="destructive"
											>
												Remove
											</DropdownMenu.Item>
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								{/if}
							</div>
						</div>
					{/each}

					{#if visibleInvites.length > 0}
						<div
							class="bg-muted/20 px-3 py-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase"
						>
							Invites
						</div>
						{#each visibleInvites as invite (invite.id)}
							<div
								class={cn(
									'grid gap-3 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
									!invite.usable && 'opacity-55'
								)}
							>
								<div class="flex min-w-0 items-center gap-2">
									<div class="min-w-0">
										<p class="truncate text-sm font-medium">Invite</p>
										<p class="truncate font-mono text-xs text-muted-foreground">{invite.code}</p>
									</div>
									{#if invite.usable}
										<Button
											type="button"
											variant="outline"
											size="sm"
											onclick={() => navigator.clipboard.writeText(invite.url)}
										>
											Copy URL
										</Button>
									{/if}
								</div>
								<div class="flex items-center justify-end gap-2">
									{#if canManageHousehold && invite.usable}
										<form method="post" action="?/updateInviteRole" class="contents">
											<input type="hidden" name="inviteId" value={invite.id} />
											<select
												name="role"
												class="h-8 rounded-md border border-input bg-background px-2 text-xs"
												onchange={(event) => event.currentTarget.form?.requestSubmit()}
											>
												{#each roleOptions as role (role.value)}
													<option value={role.value} selected={invite.role === role.value}
														>{role.label}</option
													>
												{/each}
											</select>
										</form>
									{:else}
										<span class="text-xs text-muted-foreground">{roleLabel(invite.role)}</span>
									{/if}
									{#if canManageHousehold}
										<DropdownMenu.Root>
											<DropdownMenu.Trigger
												class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
												aria-label={`Actions for invite ${invite.code}`}
											>
												<EllipsisIcon class="size-4" />
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="end" class="w-36">
												<form
													method="post"
													action="?/revokeInvite"
													use:enhance={revokeInviteEnhance(invite.id)}
												>
													<input type="hidden" name="inviteId" value={invite.id} />
													<DropdownMenu.Item
														disabled={Boolean(invite.revokedAt)}
														variant="destructive"
														onclick={(event) => {
															if (!invite.revokedAt)
																event.currentTarget.closest('form')?.requestSubmit();
														}}
													>
														{invite.revokedAt ? 'Revoked' : 'Revoke'}
													</DropdownMenu.Item>
												</form>
												<form
													method="post"
													action="?/deleteInvite"
													use:enhance={deleteInviteEnhance(invite.id)}
												>
													<input type="hidden" name="inviteId" value={invite.id} />
													<DropdownMenu.Item
														variant="destructive"
														onclick={(event) =>
															event.currentTarget.closest('form')?.requestSubmit()}
													>
														Delete
													</DropdownMenu.Item>
												</form>
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									{/if}
								</div>
							</div>
						{/each}
					{/if}
				</div>

				{#if canManageHousehold}
					<div>
						<Button type="button" variant="outline" onclick={() => (inviteDialogOpen = true)}>
							Invite people to your household
						</Button>
					</div>
				{/if}
			</section>

			<section class="grid gap-3 border-t border-border pt-4">
				<h2 class="text-sm font-medium">Danger zone</h2>
				<div class="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						disabled={!currentView.canLeaveHousehold}
						title={currentView.leaveHouseholdDisabledReason ?? undefined}
						onclick={() => (leaveHouseholdDialogOpen = true)}
					>
						Leave household
					</Button>
					{#if canManageHousehold}
						<Button
							type="button"
							variant="destructive"
							onclick={() => (deleteHouseholdFirstOpen = true)}
						>
							Delete household
						</Button>
					{/if}
				</div>
				{#if !currentView.canLeaveHousehold && currentView.leaveHouseholdDisabledReason}
					<p class="text-xs text-muted-foreground">{currentView.leaveHouseholdDisabledReason}</p>
				{/if}
			</section>
		</div>
	</main>
</div>

<Dialog.Root bind:open={inviteDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Invite people to your household</Dialog.Title>
			<Dialog.Description>
				Create an invite link for {currentView.household.name}. People who use it will join with the
				role you choose.
			</Dialog.Description>
		</Dialog.Header>

		<form method="post" action="?/createInvite" class="grid gap-4">
			<input type="hidden" name="role" value={inviteRole} />
			<input type="hidden" name="expiresInDays" value={inviteExpiresInDays} />
			<label class="grid gap-1 text-xs font-medium">
				Role
				<Select.Root type="single" bind:value={inviteRole}>
					<Select.Trigger class="!h-9 w-full text-sm">
						{roleLabel(inviteRole)}
					</Select.Trigger>
					<Select.Content>
						{#each roleOptions as role (role.value)}
							<Select.Item value={role.value}>{role.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</label>
			<div class="grid gap-3 sm:grid-cols-2">
				<label class="grid gap-1 text-xs font-medium">
					Max uses
					<Input
						name="maxUses"
						type="number"
						min="1"
						max="100"
						placeholder="Unlimited"
						class="h-9"
					/>
				</label>
				<label class="grid gap-1 text-xs font-medium">
					Expires
					<Select.Root type="single" bind:value={inviteExpiresInDays}>
						<Select.Trigger class="!h-9 w-full text-sm">
							{inviteExpiresInDays}
							{inviteExpiresInDays === '1' ? 'day' : 'days'}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="1">1 day</Select.Item>
							<Select.Item value="7">7 days</Select.Item>
							<Select.Item value="30">30 days</Select.Item>
						</Select.Content>
					</Select.Root>
				</label>
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (inviteDialogOpen = false)}
					>Cancel</Button
				>
				<Button type="submit">Create invite link</Button>
			</Dialog.Footer>
		</form>

		{#if visibleInvites.find((invite) => invite.usable)}
			<div class="grid gap-2 border-t border-border pt-4">
				<p class="text-xs font-medium text-muted-foreground">Current invite links</p>
				{#each visibleInvites.filter((invite) => invite.usable).slice(0, 3) as invite (invite.id)}
					<div class="flex min-w-0 items-center gap-2 rounded-md border border-border p-2">
						<div class="min-w-0 flex-1">
							<p class="truncate font-mono text-xs">{invite.url}</p>
							<p class="text-xs text-muted-foreground">
								{roleLabel(invite.role)} · {inviteUsageLabel(invite)} · {formatInviteExpiry(
									invite.expiresAt
								)}
							</p>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onclick={() => navigator.clipboard.writeText(invite.url)}
						>
							Copy URL
						</Button>
					</div>
				{/each}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<DeleteConfirmDialog
	bind:open={removeMemberDialogOpen}
	title="Remove member?"
	description="Remove {memberToRemove?.name ?? 'this member'} from this household."
	confirmLabel="Remove"
	formAction="?/removeMember"
	hiddenInputs={{ membershipId: memberToRemove?.id, userId: memberToRemove?.userId }}
/>

<DeleteConfirmDialog
	bind:open={leaveHouseholdDialogOpen}
	title="Leave household?"
	description="You will lose access to {currentView.household
		.name}. Your personal menu and check-in history stay with your account."
	confirmLabel="Leave household"
	formAction="?/leaveHousehold"
/>

<DeleteConfirmDialog
	bind:open={deleteHouseholdFirstOpen}
	title="Delete household?"
	description="This deletes the WorkOS organization and Maal household data for {currentView
		.household.name}."
	confirmLabel="Continue"
	onconfirm={() => {
		deleteHouseholdFirstOpen = false;
		deleteHouseholdSecondOpen = true;
	}}
/>

<DeleteConfirmDialog
	bind:open={deleteHouseholdSecondOpen}
	title="Really delete household?"
	description="This cannot be undone. Recipes saved to your menu stay, but household settings and planned meals are deleted."
	confirmLabel="Delete household"
	formAction="?/deleteHousehold"
/>
