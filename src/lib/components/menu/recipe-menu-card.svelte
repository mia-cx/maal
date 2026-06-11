<script lang="ts">
	import { mealFeedbackVerdictLabels } from '$lib/components/dashboard/meal-labels';
	import * as Card from '$lib/components/ui/card';
	import { cn } from '$lib/utils';
	import MessageSquareTextIcon from '@lucide/svelte/icons/message-square-text';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import StarIcon from '@lucide/svelte/icons/star';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import {
		applianceLabel,
		formatDate,
		menuLoadAccentClasses,
		recipeMentalLoad,
		recipePrimaryMetadata,
		recipeReviewCount,
		verdictToneClasses
	} from './menu-format';
	import type { RecipeMenuItem } from './menu-types';

	let {
		recipe,
		onselect
	}: { recipe: RecipeMenuItem; onselect?: (recipe: RecipeMenuItem) => void } = $props();

	const primaryMetadata = $derived(recipePrimaryMetadata(recipe));
	const totalReviews = $derived(recipeReviewCount(recipe));
	const mealLoad = $derived(recipeMentalLoad(recipe));
	const reviewToneClass = $derived(
		recipe.latestVerdict ? verdictToneClasses[recipe.latestVerdict] : 'text-muted-foreground'
	);
	const supportingTags = $derived([
		...recipe.appliances.slice(0, 2).map(applianceLabel),
		...(recipe.dietTags?.slice(0, 2) ?? [])
	]);

	const selectRecipe = () => onselect?.(recipe);
</script>

<button
	type="button"
	aria-label={`Open ${recipe.title}`}
	class="group h-full min-w-0 appearance-none border-0 bg-transparent p-0 text-left text-inherit"
	onclick={selectRecipe}
>
	<Card.Root
		size="sm"
		class={cn(
			"relative h-full min-w-0 gap-0 overflow-hidden bg-card/50 py-0 shadow-sm ring-1 ring-border/70 transition-colors after:absolute after:inset-y-0 after:left-0 after:w-1 after:content-[''] hover:ring-foreground/25 data-[size=sm]:py-0",
			menuLoadAccentClasses[mealLoad]
		)}
	>
		{#if recipe.image}
			<img
				src={recipe.image}
				alt=""
				loading="lazy"
				class="aspect-[2/1] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
			/>
		{/if}

		<Card.Header class="space-y-1.5 p-3 pb-2 pl-4">
			<div class="flex items-start gap-3">
				<div class="min-w-0 flex-1">
					<Card.Title class="line-clamp-2 text-sm leading-tight font-semibold">
						{recipe.title}
					</Card.Title>
					{#if recipe.sourceSiteName}
						<p class="mt-1 truncate text-xs text-muted-foreground">
							{recipe.sourceSiteName}{recipe.sourceAuthorName
								? ` · ${recipe.sourceAuthorName}`
								: ''}
						</p>
					{/if}
				</div>
				{#if recipe.latestVerdict}
					<div class={cn('flex shrink-0 items-center gap-1 text-xs font-medium', reviewToneClass)}>
						<StarIcon class="size-3.5" />
						<span class="sr-only">{mealFeedbackVerdictLabels[recipe.latestVerdict]}</span>
					</div>
				{/if}
			</div>
			<p class="line-clamp-2 text-xs leading-5 text-muted-foreground">{recipe.description}</p>
		</Card.Header>

		<Card.Content class="space-y-2.5 p-3 pt-0 pl-4">
			<div
				class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.6875rem] leading-tight text-muted-foreground"
			>
				{#each primaryMetadata as item, index (item)}
					{#if index > 0}<span aria-hidden="true" class="text-muted-foreground/60">•</span>{/if}
					<span class="inline-flex min-w-0 items-center gap-1 first:tabular-nums">
						{#if index === 0}<TimerIcon class="size-3 shrink-0" />{/if}
						<span>{item}</span>
					</span>
				{/each}
			</div>

			<div
				class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
			>
				<span class="inline-flex items-center gap-1">
					<RepeatIcon class="size-3.5" />
					<strong class="font-medium text-foreground">{recipe.timesCooked}</strong> cooked
				</span>
				<span aria-hidden="true" class="text-muted-foreground/60">•</span>
				<span
					><strong class="font-medium text-foreground">{recipe.plannedCount}</strong> planned</span
				>
				<span aria-hidden="true" class="text-muted-foreground/60">•</span>
				<span class="inline-flex items-center gap-1">
					<MessageSquareTextIcon class="size-3.5" />
					<strong class="font-medium text-foreground">{totalReviews}</strong> reviews
				</span>
				{#if recipe.lastCookedAt}
					<span aria-hidden="true" class="text-muted-foreground/60">•</span>
					<span>{formatDate(recipe.lastCookedAt)}</span>
				{/if}
			</div>

			{#if supportingTags.length}
				<p class="line-clamp-1 text-[0.6875rem] text-muted-foreground">
					{supportingTags.join(' · ')}
				</p>
			{/if}

			{#if recipe.reviewSummary.notes[0]}
				<p class="line-clamp-2 text-xs leading-5 text-muted-foreground/90">
					“{recipe.reviewSummary.notes[0]}”
				</p>
			{/if}
		</Card.Content>
	</Card.Root>
</button>
