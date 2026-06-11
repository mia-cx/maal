<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as ButtonGroup from '$lib/components/ui/button-group';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import WordmarkLogo from '$lib/components/wordmark-logo.svelte';
	import type { ScheduleMode } from './schedule-types';

	let {
		mode,
		showDateControls = true,
		showStepControls = true,
		onmodechange,
		onprevious,
		onnext,
		ontoday
	}: {
		mode: ScheduleMode;
		showDateControls?: boolean;
		showStepControls?: boolean;
		onmodechange?: (mode: ScheduleMode) => void;
		onprevious?: () => void;
		onnext?: () => void;
		ontoday?: () => void;
	} = $props();
</script>

<header
	class="sticky top-0 z-40 flex h-[52px] shrink-0 items-center border-b border-border bg-background px-2"
>
	<div class="flex shrink-0 items-center gap-2 text-foreground">
		<div class="flex w-9 shrink-0 items-center justify-center">
			<Sidebar.Trigger />
		</div>
		<WordmarkLogo class="h-5 w-16" />
	</div>
	<ButtonGroup.Root
		aria-label="Meal plan view"
		class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
	>
		<Button
			variant={mode === 'daily' ? 'default' : 'outline'}
			size="sm"
			onclick={() => onmodechange?.('daily')}
		>
			Day
		</Button>
		<Button
			variant={mode === 'multi-day' ? 'default' : 'outline'}
			size="sm"
			onclick={() => onmodechange?.('multi-day')}
		>
			Multi-day
		</Button>
		<Button
			variant={mode === 'monthly' ? 'default' : 'outline'}
			size="sm"
			onclick={() => onmodechange?.('monthly')}
		>
			Month
		</Button>
	</ButtonGroup.Root>

	<div class="ml-auto flex min-w-0 justify-end">
		{#if showDateControls}
			<div class="hidden items-center gap-2 md:flex">
				{#if showStepControls}
					<Button variant="outline" size="icon-sm" onclick={onprevious} aria-label="Previous"
						>‹</Button
					>
				{/if}
				<Button variant="outline" size="sm" onclick={ontoday}>Today</Button>
				{#if showStepControls}
					<Button variant="outline" size="icon-sm" onclick={onnext} aria-label="Next">›</Button>
				{/if}
			</div>
		{/if}
	</div>
</header>

{#if showDateControls}
	<Button
		variant="outline"
		size="sm"
		onclick={ontoday}
		class="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-[calc(env(safe-area-inset-left)+1rem)] z-[45] bg-popover text-popover-foreground opacity-100 shadow-none hover:bg-popover md:hidden dark:bg-popover dark:hover:bg-popover"
	>
		Today
	</Button>
{/if}
