<script lang="ts">
	import type { Profile } from '$lib/domain/household/contracts.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';

	let {
		profiles,
		activeProfileId,
		busyProfileId,
		error,
		onswitch
	}: {
		profiles: readonly Profile[];
		activeProfileId: string | null;
		busyProfileId: string | null;
		error: string | null;
		onswitch: (profile: Profile) => void | Promise<void>;
	} = $props();

	const initials = (profile: Profile): string =>
		profile.displayName
			.split(/\s+/)
			.map((part) => part[0] ?? '')
			.join('')
			.slice(0, 2)
			.toUpperCase();
</script>

<div class="grid max-w-lg gap-4 text-sm">
	<div class="grid gap-1">
		<p class="text-xs font-medium">Profiles on this device</p>
		<p class="text-xs text-muted-foreground">
			Switching profiles changes the local view. It does not sign anyone else out.
		</p>
	</div>

	{#if profiles.length === 0}
		<p class="rounded-md border border-border p-3 text-xs text-muted-foreground">
			No local profile is available yet. Add a real user from the profile menu.
		</p>
	{:else}
		<ul class="divide-y rounded-md border border-border">
			{#each profiles as profile (profile.profileId)}
				<li class="flex items-center gap-3 px-3 py-2">
					<Avatar.Root class="size-9 rounded-lg after:rounded-lg">
						<Avatar.Image src={profile.profilePictureUrl ?? undefined} alt={profile.displayName} />
						<Avatar.Fallback class="rounded-lg">{initials(profile)}</Avatar.Fallback>
					</Avatar.Root>
					<div class="grid min-w-0 flex-1">
						<span class="truncate text-xs font-medium">{profile.displayName}</span>
						<span class="truncate text-xs text-muted-foreground">
							{profile.email ?? 'Offline profile'}
						</span>
					</div>
					{#if profile.profileId === activeProfileId}
						<span class="text-xs font-medium text-muted-foreground">Current</span>
					{:else}
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busyProfileId !== null}
							onclick={() => onswitch(profile)}
						>
							{busyProfileId === profile.profileId ? 'Switching…' : 'Switch'}
						</Button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
</div>
