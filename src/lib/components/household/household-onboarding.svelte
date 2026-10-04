<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { untrack } from 'svelte';

	import {
		createRemoteHousehold,
		joinRemoteHousehold
	} from '$lib/client/household-administration.js';
	import type { MaalDatabase } from '$lib/client/local/database.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';

	let {
		database,
		profileId,
		defaultHouseholdName = ''
	}: { database: MaalDatabase; profileId: string; defaultHouseholdName?: string } = $props();
	let householdName = $state(untrack(() => defaultHouseholdName));
	let inviteCode = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const createHousehold = async (event: SubmitEvent) => {
		event.preventDefault();
		const name = householdName.trim();
		if (!name || busy) return;
		busy = true;
		error = null;
		try {
			const profile = await database.profiles.get(profileId);
			if (!profile) throw new Error('profile missing');
			await createRemoteHousehold(database, profileId, {
				name,
				locale: profile.locale,
				timezone: profile.timezone
			});
		} catch {
			error = m.household_could_not_create_try_again();
		} finally {
			busy = false;
		}
	};

	const joinHousehold = async () => {
		const code = inviteCode.trim();
		if (!code || busy) return;
		busy = true;
		error = null;
		try {
			await joinRemoteHousehold(database, profileId, code);
		} catch {
			error = m.household_could_not_open_invite();
		} finally {
			busy = false;
		}
	};
</script>

<section class="flex min-h-[calc(100svh-52px)] min-w-0 bg-background p-4 text-foreground">
	<div class="container mx-auto grid max-w-md content-center gap-6">
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
				{busy ? m.household_creating() : m.household_create()}
			</Button>
		</form>

		<div class="grid gap-2 border-t border-border pt-4">
			<label class="grid gap-1 text-sm font-medium text-muted-foreground">
				{m.household_invite_code()}
				<Input
					bind:value={inviteCode}
					placeholder={m.household_paste_an_invite_code()}
					class="h-9 font-mono uppercase"
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
