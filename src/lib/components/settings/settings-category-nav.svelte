<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { cn } from '$lib/utils';
	import type { SettingsCategory } from '$lib/settings/categories';
	import type { SettingsCategoryId } from '$lib/settings/types';

	let {
		activeCategory,
		categories,
		onchoose
	}: {
		activeCategory: SettingsCategoryId;
		categories: SettingsCategory[];
		onchoose: (category: SettingsCategory) => void;
	} = $props();
</script>

<aside class="overflow-y-auto border-b border-border bg-muted/25 p-2 md:border-r md:border-b-0">
	<Dialog.Header class="px-2 py-2">
		<Dialog.Title>Settings</Dialog.Title>
	</Dialog.Header>
	<nav aria-label="Settings categories" class="mt-1 grid gap-1">
		{#each categories as category (category.id)}
			<button
				type="button"
				disabled={category.disabled}
				class={cn(
					'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-xs/relaxed transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none',
					category.disabled &&
						'cursor-not-allowed text-muted-foreground/45 opacity-60 hover:bg-transparent',
					activeCategory === category.id &&
						'bg-background text-foreground shadow-sm ring-1 ring-border'
				)}
				aria-current={activeCategory === category.id ? 'page' : undefined}
				title={category.disabled ? 'Coming soon' : undefined}
				onclick={() => onchoose(category)}
			>
				<category.icon class="size-3.5 shrink-0" />
				<span class="truncate font-medium">{category.label}</span>
				{#if category.disabled}
					<span class="ml-auto text-[0.625rem] font-medium">Soon</span>
				{/if}
			</button>
		{/each}
	</nav>
</aside>
