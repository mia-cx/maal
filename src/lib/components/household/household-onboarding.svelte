<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { onMount, untrack } from 'svelte';
	import { uuidv7 } from 'uuidv7';

	import {
		createRemoteHousehold,
		fetchHouseholdOnboardingEligibility,
		joinRemoteHousehold
	} from '$lib/client/household-administration.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';

	let {
		database,
		profileId,
		defaultHouseholdName = '',
		inviteCode: initialInviteCode = '',
		standalone = false,
		hasHouseholds = false,
		busy = $bindable(false),
		oncomplete
	}: {
		database: MaalDatabase;
		profileId: string;
		defaultHouseholdName?: string;
		standalone?: boolean;
		hasHouseholds?: boolean;
		busy?: boolean;
		/** Prefills the join field, e.g. from a shared `/invite/<code>` link. */
		inviteCode?: string;
		/** Runs after the new or joined household is committed to Dexie and selected. */
		oncomplete?: (householdId: string, trialStarted?: boolean) => void | Promise<void>;
	} = $props();
	let householdName = $state(untrack(() => defaultHouseholdName));
	let inviteCode = $state(untrack(() => initialInviteCode));
	let error = $state<string | null>(null);
	let trialEligible = $state<boolean | undefined>(undefined);
	// One idempotency key per submitted name, so retrying after a lost response reuses it.
	let createIntent: { name: string; idempotencyKey: string } | null = null;

	onMount(() => {
		if (standalone) {
			void fetchHouseholdOnboardingEligibility(database, profileId)
				.catch(() => false)
				.then((eligible) => {
					trialEligible = eligible;
				});
		}
	});

	const createHousehold = async (event: SubmitEvent) => {
		event.preventDefault();
		const name = householdName.trim();
		if (!name || busy || (standalone && trialEligible === undefined)) return;
		const startTrial = standalone && trialEligible === true;
		if (createIntent?.name !== name) createIntent = { name, idempotencyKey: uuidv7() };
		const { idempotencyKey } = createIntent;
		busy = true;
		error = null;
		let created: Awaited<ReturnType<typeof createRemoteHousehold>>;
		try {
			const profile = await database.profiles.get(profileId);
			if (!profile) throw new Error('profile missing');
			created = await createRemoteHousehold(database, profileId, {
				name,
				locale: profile.locale,
				timezone: profile.timezone,
				idempotencyKey,
				...(startTrial ? { startTrial: true } : {})
			});
		} catch {
			error = m.household_could_not_create_try_again();
			busy = false;
			return;
		}
		createIntent = null;
		try {
			await oncomplete?.(
				created.householdId,
				standalone ? created.trialStarted === true : undefined
			);
		} finally {
			busy = false;
		}
	};

	const joinHousehold = async () => {
		const code = inviteCode.trim();
		if (!code || busy) return;
		busy = true;
		error = null;
		let householdId: string;
		try {
			({ householdId } = await joinRemoteHousehold(database, profileId, code));
		} catch {
			error = m.household_could_not_open_invite();
			busy = false;
			return;
		}
		try {
			await oncomplete?.(householdId);
		} finally {
			busy = false;
		}
	};
</script>

<section
	class={[
		'flex min-w-0 bg-background p-4 text-foreground',
		standalone ? 'h-svh' : 'min-h-[calc(100svh-52px)]'
	]}
>
	<div class="container mx-auto grid max-w-md content-center gap-6">
		{#if hasHouseholds}
			<div>
				<Button href={resolve('/plan')} variant="ghost">{m.household_back_to_meal_plan()}</Button>
			</div>
		{/if}
		<div class="grid gap-2">
			<WordmarkLogo class="h-6 w-auto" />
			<h1 class="text-xl font-semibold tracking-tight">{m.household_set_up_your_household()}</h1>
			<p class="text-sm text-muted-foreground">
				{m.household_keep_meal_plans_in_a_household_so_cooking_hi()}
			</p>
		</div>

		<form class="grid gap-3" onsubmit={createHousehold}>
			<label class="grid gap-1 text-sm font-medium">
				{m.household_household_name()}
				<Input
					bind:value={householdName}
					autocomplete="organization"
					placeholder={m.household_home()}
					class="h-9"
				/>
			</label>
			<Button
				type="submit"
				disabled={busy || !householdName.trim() || (standalone && trialEligible === undefined)}
			>
				{busy
					? m.household_creating()
					: trialEligible
						? m.household_create_and_start_trial()
						: m.household_create()}
			</Button>
		</form>

		<div class="grid gap-2 border-t border-border pt-4">
			<label class="grid gap-1 text-sm font-medium text-muted-foreground">
				{m.household_invite_code()}
				<Input
					bind:value={inviteCode}
					placeholder={m.household_paste_an_invite_code()}
					class="h-9"
				/>
			</label>
			<Button
				variant="outline"
				disabled={busy || !inviteCode.trim()}
				onclick={() => void joinHousehold()}
			>
				{m.household_join_household()}
			</Button>
			<p class="text-xs text-muted-foreground">
				{m.household_have_an_invite_code_join_that_household_inst()}
			</p>
		</div>

		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
	</div>
</section>
