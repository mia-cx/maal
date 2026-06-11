<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	let { defaultHouseholdName = '' }: { defaultHouseholdName?: string } = $props();

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

	const createHousehold = async (event: SubmitEvent) => {
		event.preventDefault();
		const name = householdName.trim();
		if (!name) return;
		busy = true;
		error = null;

		const response = await fetch('/household/onboarding', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name })
		});

		busy = false;
		if (!response.ok) {
			error = await readError(response, 'Could not create household.');
			return;
		}

		await goto(resolve('/plan'), { invalidateAll: true });
	};
</script>

<section class="flex h-svh min-w-0 items-center justify-center bg-background p-4 text-foreground">
	<div
		class="grid w-full max-w-md gap-6 rounded-xl border border-border bg-background p-5 shadow-sm"
	>
		<div class="grid gap-2">
			<h1 class="text-xl font-semibold tracking-tight">Set up your household</h1>
			<p class="text-sm text-muted-foreground">
				Maal keeps meal plans in a household so cooking history, menus, and plans can be shared.
			</p>
		</div>

		<form class="grid gap-3" onsubmit={createHousehold}>
			<label class="grid gap-1 text-sm font-medium">
				Household name
				<Input
					bind:value={householdName}
					autocomplete="organization"
					placeholder="Home"
					class="h-9"
				/>
			</label>
			<Button type="submit" disabled={busy || !householdName.trim()}>
				{busy ? 'Creating…' : 'Create household'}
			</Button>
		</form>

		<div class="grid gap-2 border-t border-border pt-4">
			<label class="grid gap-1 text-sm font-medium text-muted-foreground">
				Invite code
				<Input bind:value={inviteCode} placeholder="Coming soon" class="h-9" disabled />
			</label>
			<Button variant="outline" disabled>Join household</Button>
			<p class="text-xs text-muted-foreground">Invite codes are coming later.</p>
		</div>

		{#if error}
			<p class="text-sm text-destructive">{error}</p>
		{/if}
	</div>
</section>
