<script lang="ts">
	import ScheduleMealPool from './schedule-meal-pool.svelte';
	import type {
		Meal,
		MealAddHandler,
		MealDropTarget,
		MealPickHandler,
		MealSelectHandler
	} from './schedule-types';

	let {
		draggingMealId,
		draggedMeal,
		dropTarget,
		onaddmeal,
		onpick,
		onselect,
		meals,
		density,
		showImages
	}: {
		draggingMealId?: string;
		draggedMeal?: Meal | null;
		dropTarget?: MealDropTarget | null;
		onaddmeal?: MealAddHandler;
		onpick?: MealPickHandler;
		onselect?: MealSelectHandler;
		meals: Meal[];
		density?: 'title' | 'detail';
		showImages?: boolean;
	} = $props();
</script>

<div class="border-b border-border">
	<ScheduleMealPool
		{draggingMealId}
		{draggedMeal}
		{dropTarget}
		{onaddmeal}
		{onpick}
		{onselect}
		{meals}
		{density}
		{showImages}
	/>
</div>
