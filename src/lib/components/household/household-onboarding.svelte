<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { setActiveHouseholdId } from '$lib/stores/active-household';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';

	let {
		defaultHouseholdName = '',
		canStartTrial = false,
		hasHouseholds = false
	}: { defaultHouseholdName?: string; canStartTrial?: boolean; hasHouseholds?: boolean } = $props();

	let householdName = $state('');
	let initializedDefaultHouseholdName = $state(false);
	let inviteCode = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const readError = async (response: Response, fallback: string): Promise<string> => {
		try {
			const body = (await response.json()) as { message?: unknown };
			if (typeof body.message === 'string' && body.message.trim()) return body.message;
		} catch {
			// Keep fallback.
		}
		return fallback;
	};

	$effect(() => {
		if (initializedDefaultHouseholdName) return;
		initializedDefaultHouseholdName = true;
		householdName = defaultHouseholdName;
	});

	const joinInvitedHousehold = async () => {
		const code = inviteCode.trim();
		if (!code || busy) return;
		busy = true;
		error = null;
		try {
			await goto(resolve(`/invite/${encodeURIComponent(code)}`));
		} catch {
			error = m.household_could_not_open_invite();
			busy = false;
		}
	};

	const createHousehold = async (event: SubmitEvent) => {
		event.preventDefault();
		const name = householdName.trim();
		if (!name) return;
		busy = true;
		error = null;

		try {
			const response = await fetch('/household/onboarding', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name })
			});

			if (!response.ok) {
				error = await readError(response, m.household_could_not_create());
				busy = false;
				return;
			}

			const body: unknown = await response.json();
			if (!body || typeof body !== 'object') {
				throw new Error(m.household_invalid_onboarding_response());
			}
			const trialStarted = 'trialStarted' in body && body.trialStarted === true;
			const household = 'household' in body ? body.household : null;
			const householdId =
				household &&
				typeof household === 'object' &&
				'id' in household &&
				typeof household.id === 'string'
					? household.id
					: null;
			if (!householdId) throw new Error(m.household_created_response_missing_id());
			setActiveHouseholdId(householdId);
			await goto(resolve(trialStarted ? '/plan?trial=started' : '/subscribe'), {
				invalidateAll: true
			});
		} catch {
			error = m.household_could_not_create_try_again();
			busy = false;
		}
	};
</script>

<section class="flex h-svh min-w-0 bg-background p-4 text-foreground">
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
			<Button type="submit" disabled={busy || !householdName.trim()}>
				{busy
					? m.household_creating()
					: canStartTrial
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
			<Button variant="outline" disabled={!inviteCode.trim()} onclick={joinInvitedHousehold}>
				{m.household_join_household()}
			</Button>
			<p class="text-xs text-muted-foreground">
				{m.household_have_an_invite_code_join_that_household_inst()}
			</p>
		</div>

		{#if error}
			<p class="text-sm text-destructive">{error}</p>
		{/if}
	</div>
</section>
