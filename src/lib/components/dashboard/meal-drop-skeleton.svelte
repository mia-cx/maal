<script lang="ts">
	import { cn } from '$lib/utils.js';
	import MealPlanCard from './meal-plan-card.svelte';
	import type { Meal, MealCardDensity } from './schedule-types';

	let {
		meal,
		density = 'summary',
		showImages = false,
		imageLayout = 'side',
		imageAspect = 'landscape',
		class: className
	}: {
		meal?: Meal | null;
		density?: MealCardDensity;
		showImages?: boolean;
		imageLayout?: 'side' | 'side-compact' | 'top' | 'adaptive';
		imageAspect?: 'landscape' | 'portrait';
		class?: string;
	} = $props();

	const heightClass = $derived(
		density === 'detail' ? 'min-h-20' : density === 'summary' ? 'min-h-10' : 'min-h-6'
	);
	const skeletonClass =
		'pointer-events-none rounded-md border border-dashed border-primary/70 bg-primary/10 shadow-sm ring-1 ring-primary/10';
</script>

{#if meal}
	<div aria-hidden="true" class={cn('pointer-events-none relative min-w-0', className)}>
		<div class="invisible">
			<MealPlanCard
				{meal}
				{density}
				showImage={showImages}
				{imageLayout}
				{imageAspect}
				class="w-full"
			/>
		</div>
		<div class={cn('absolute inset-0', skeletonClass)}></div>
	</div>
{:else}
	<div aria-hidden="true" class={cn(skeletonClass, heightClass, className)}></div>
{/if}
