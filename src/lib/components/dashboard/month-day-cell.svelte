<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { onMount, tick } from 'svelte';
	import { dateKey, isSameMonth, isToday } from './schedule-date';
	import ScheduledMealList from './scheduled-meal-list.svelte';
	import type { Meal, MealDropTarget, MealPickHandler, MealSelectHandler } from './schedule-types';

	let {
		day,
		index,
		anchorDate,
		meals,
		draggingMealId,
		draggedMeal,
		dropTarget,
		onpick,
		onselect,
		onselectdate
	}: {
		day: Date;
		index: number;
		anchorDate: Date;
		meals: Meal[];
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onpick?: MealPickHandler;
		onselect?: MealSelectHandler;
		onselectdate?: (date: Date) => void;
	} = $props();

	let sectionElement: HTMLElement;
	let contentElement: HTMLDivElement;
	let visibleMealCount = $state(0);
	let measureVersion = 0;
	let lastMeasurementKey = '';

	const dayKey = $derived(dateKey(day));
	const isInMonth = $derived(isSameMonth(day, anchorDate));
	const previewIndex = $derived(
		dropTarget?.kind === 'date' && dropTarget.date === dayKey ? dropTarget.index : -1
	);
	const previewSourceMeals = $derived(
		previewIndex >= 0 ? meals.filter((meal) => meal.id !== draggingMealId) : meals
	);
	const monthVisibleMeals = $derived(previewSourceMeals.slice(0, visibleMealCount));
	const overflowCount = $derived(Math.max(0, previewSourceMeals.length - visibleMealCount));
	const overflowLabel = $derived(
		visibleMealCount === 0 ? `${overflowCount} meals` : `+${overflowCount} more`
	);
	const outlineDropCell = $derived(previewIndex >= 0 && overflowCount > 0);
	const visiblePreviewIndex = $derived(outlineDropCell ? -1 : previewIndex);
	const measurementKey = $derived(
		[
			dayKey,
			previewIndex,
			draggingMealId ?? '',
			previewSourceMeals.map((meal) => meal.id).join(',')
		].join('|')
	);

	const fitVisibleMeals = async () => {
		const version = ++measureVersion;
		visibleMealCount = previewSourceMeals.length;
		await tick();

		while (
			version === measureVersion &&
			contentElement &&
			contentElement.scrollHeight > contentElement.clientHeight + 1 &&
			visibleMealCount > 0
		) {
			visibleMealCount -= 1;
			await tick();
		}
	};

	onMount(() => {
		const resizeObserver = new ResizeObserver(() => void fitVisibleMeals());
		if (sectionElement) resizeObserver.observe(sectionElement);
		return () => resizeObserver.disconnect();
	});

	$effect(() => {
		if (measurementKey === lastMeasurementKey) return;
		lastMeasurementKey = measurementKey;
		void fitVisibleMeals();
	});
</script>

<section
	bind:this={sectionElement}
	data-meal-drop-kind={isInMonth ? 'date' : undefined}
	data-meal-drop-date={isInMonth ? dayKey : undefined}
	class={cn(
		'flex min-h-0 min-w-0 flex-col overflow-hidden border-border p-1',
		outlineDropCell && 'bg-primary/5 ring-2 ring-primary/60 ring-inset'
	)}
	class:border-l={index % 7 !== 0}
	class:border-t={index >= 7}
>
	<button
		type="button"
		class:text-muted-foreground={!isInMonth}
		class="mb-0.5 ml-auto flex size-5 shrink-0 items-center justify-center rounded-sm text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
		class:bg-primary={isToday(day)}
		class:text-primary-foreground={isToday(day)}
		onclick={() => onselectdate?.(day)}
		aria-label={`Open ${dayKey} in day view`}
	>
		{day.getDate()}
	</button>

	<div bind:this={contentElement} class="min-h-0 flex-1 space-y-1 overflow-hidden">
		<ScheduledMealList
			meals={monthVisibleMeals}
			previewIndex={visiblePreviewIndex}
			{draggingMealId}
			{draggedMeal}
			compact
			density="title"
			showEmpty={false}
			{onpick}
			{onselect}
		/>
		{#if overflowCount > 0}
			<button
				type="button"
				class="h-5 w-full truncate pl-2.5 text-left text-xs leading-none font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
				onclick={() => onselectdate?.(day)}
			>
				{overflowLabel}
			</button>
		{/if}
	</div>
</section>
