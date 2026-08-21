<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { untrack } from 'svelte';
	import { keyboardShortcut } from '$lib/actions/keyboard-shortcut';
	import { createDraftRecipe } from '$lib/menu/recipe-draft.js';
	import type { UnitPreferences } from '$lib/recipes/ingredient-text.js';
	import AddMealDialog from './add-meal-dialog.svelte';
	import ContinuousSchedule from './continuous-schedule.svelte';
	import { RecipeEditSheet, type RecipeMenuItem } from '$lib/components/menu/index.js';
	import MealCheckInDialog, { type MealCheckInPayload } from './meal-check-in-dialog.svelte';
	import MealDragOverlay from './meal-drag-overlay.svelte';
	import MealPreviewDialog from './meal-preview-dialog.svelte';
	import MonthSchedule from './month-schedule.svelte';
	import MultiDaySchedule from './multi-day-schedule.svelte';
	import ScheduleHeader from './schedule-header.svelte';
	import { addDays, addMonths, dateFromKey, dateKey, startOfDay } from './schedule-date.js';
	import { dropTargetFromPointer, moveMealToDropTarget } from './schedule-dnd.js';
	import { cardDirectionByKey, focusMealCard } from './schedule-keyboard.js';
	import { isMealInPool, sortMealPool } from './schedule-ordering.js';
	import type {
		DailyScrollState,
		HouseholdMember,
		Meal,
		MealDropTarget,
		ScheduleMode
	} from './schedule-types.js';

	type ScheduleUiSnapshot = {
		scheduleMode: ScheduleMode;
		scheduleAnchorDate: string;
		dailyScroll: DailyScrollState | null;
	};

	let {
		meals: incomingMeals = [],
		recipes = [],
		weekStartsOn = 'monday',
		householdTimeZone,
		currentUserId,
		householdMembers = [],
		unitPreferences = {},
		initialUiState,
		onplanrecipe,
		onmealchange,
		onmealdelete,
		onmealcheckin,
		oncreaterecipe,
		onimporturl,
		onuistatechange
	}: {
		meals?: Meal[];
		recipes?: RecipeMenuItem[];
		weekStartsOn?: 'sunday' | 'monday';
		householdTimeZone?: string;
		currentUserId?: string;
		householdMembers?: HouseholdMember[];
		unitPreferences?: UnitPreferences;
		initialUiState: ScheduleUiSnapshot;
		onplanrecipe?: (
			recipe: RecipeMenuItem,
			date?: string,
			target?: MealDropTarget
		) => Promise<Meal>;
		onmealchange?: (meal: Meal, previous?: Meal) => void | Promise<void>;
		onmealdelete?: (meal: Meal) => void | Promise<void>;
		onmealcheckin?: (payload: MealCheckInPayload) => Promise<Meal>;
		oncreaterecipe?: (recipe: RecipeMenuItem, date?: string) => Promise<Meal>;
		onimporturl?: (url: string, date?: string) => Promise<Meal>;
		onuistatechange?: (state: ScheduleUiSnapshot) => void | Promise<void>;
	} = $props();

	const mealPoolImageMinHeight = 760;
	const startingUiState = untrack(() => initialUiState);
	let scheduleMeals = $state<Meal[]>([]);
	let selectedMealId = $state<string | null>(null);
	let mode = $state<ScheduleMode>(startingUiState.scheduleMode);
	let anchorDate = $state(dateFromKey(startingUiState.scheduleAnchorDate));
	let dailyScroll = $state<DailyScrollState | null>(startingUiState.dailyScroll);
	let multiDayStep = $state(7);
	let todaySignal = $state(0);
	let dayNavigationSignal = $state(0);
	let dashboardHeight = $state(0);
	let draggedMeal = $state<Meal | null>(null);
	let draggedPointerId = $state<number | null>(null);
	let previewOpen = $state(false);
	let checkInOpen = $state(false);
	let checkInMeal = $state<Meal | null>(null);
	let addMealOpen = $state(false);
	let addMealDate = $state<string | undefined>();
	let addMealBusy = $state(false);
	let addMealError = $state<string | null>(null);
	let recipeEditorOpen = $state(false);
	let draftRecipe = $state<RecipeMenuItem | null>(null);
	let dragX = $state(0);
	let dragY = $state(0);
	let dropTarget = $state<MealDropTarget | null>(null);
	let secondaryScrollPointerId: number | null = null;
	let secondaryScrollElement: HTMLElement | null = null;
	let secondaryScrollX = 0;
	let secondaryScrollY = 0;

	const mealPool = $derived(sortMealPool(scheduleMeals.filter(isMealInPool)));
	const plannedMeals = $derived(scheduleMeals.filter((meal) => !isMealInPool(meal)));
	const selectedMeal = $derived(scheduleMeals.find((meal) => meal.id === selectedMealId) ?? null);
	const showDateControls = $derived(true);
	const showStepControls = $derived(mode === 'multi-day' || mode === 'monthly');
	const showMealPoolImages = $derived(dashboardHeight >= mealPoolImageMinHeight);
	const scheduleModeByKey: Record<string, ScheduleMode> = {
		d: 'daily',
		w: 'multi-day',
		m: 'monthly'
	};
	const scheduleShortcutCombos = [
		'ArrowLeft',
		'ArrowRight',
		'ArrowUp',
		'ArrowDown',
		'h',
		'j',
		'k',
		'l',
		'd',
		'w',
		'm'
	].map((key) => ({ key, meta: false, ctrl: false, alt: false }));

	const clearDailyScroll = () => {
		dailyScroll = null;
	};

	const moveByDay = (dayDelta: number) => {
		anchorDate = startOfDay(addDays(anchorDate, dayDelta));
		dayNavigationSignal += 1;
		if (mode === 'daily') clearDailyScroll();
	};

	const moveByMonthRow = (rowDelta: number): boolean => {
		if (mode !== 'monthly') return false;
		anchorDate = startOfDay(addDays(anchorDate, rowDelta * 7));
		return true;
	};

	const handleScheduleShortcut = (event: KeyboardEvent) => {
		const activeMealCard =
			event.target instanceof Element
				? event.target.closest<HTMLElement>('[data-meal-card-id]')
				: null;
		const cardDirection =
			cardDirectionByKey[event.key] ?? cardDirectionByKey[event.key.toLowerCase()];
		if (activeMealCard && cardDirection) {
			event.preventDefault();
			focusMealCard(activeMealCard, cardDirection);
			return;
		}
		if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'h') {
			event.preventDefault();
			moveByDay(-1);
			return;
		}
		if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'l') {
			event.preventDefault();
			moveByDay(1);
			return;
		}
		if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'k') {
			if (moveByMonthRow(-1)) event.preventDefault();
			return;
		}
		if (event.key === 'ArrowDown' || event.key.toLowerCase() === 'j') {
			if (moveByMonthRow(1)) event.preventDefault();
			return;
		}
		const nextMode = scheduleModeByKey[event.key.toLowerCase()];
		if (nextMode && nextMode !== mode) {
			event.preventDefault();
			mode = nextMode;
		}
	};

	const previous = () => {
		anchorDate =
			mode === 'multi-day' ? addDays(anchorDate, -multiDayStep) : addMonths(anchorDate, -1);
	};
	const next = () => {
		anchorDate =
			mode === 'multi-day' ? addDays(anchorDate, multiDayStep) : addMonths(anchorDate, 1);
	};
	const todayKey = (): string => {
		if (!householdTimeZone) return dateKey(new Date());
		const parts = Object.fromEntries(
			new Intl.DateTimeFormat('en-CA', {
				timeZone: householdTimeZone,
				year: 'numeric',
				month: '2-digit',
				day: '2-digit'
			})
				.formatToParts(new Date())
				.map(({ type, value }) => [type, value])
		);
		return `${parts.year}-${parts.month}-${parts.day}`;
	};
	const today = () => {
		anchorDate = dateFromKey(todayKey());
		clearDailyScroll();
		todaySignal += 1;
	};
	const openDay = (date: Date) => {
		anchorDate = startOfDay(date);
		clearDailyScroll();
		mode = 'daily';
	};
	const updateDailyScroll = (scrollState: DailyScrollState) => {
		dailyScroll = scrollState;
	};
	const updateVisibleAnchor = (date: Date) => {
		anchorDate = startOfDay(date);
	};
	const updateRenderedMealRange = () => {};

	const replaceMeal = (nextMeal: Meal) => {
		scheduleMeals = scheduleMeals.map((meal) => (meal.id === nextMeal.id ? nextMeal : meal));
		if (checkInMeal?.id === nextMeal.id) checkInMeal = nextMeal;
	};

	const planAndPreview = async (recipe: RecipeMenuItem, date = addMealDate) => {
		if (!onplanrecipe) return;
		addMealBusy = true;
		addMealError = null;
		try {
			const meal = await onplanrecipe(recipe, date);
			scheduleMeals = [...scheduleMeals.filter((candidate) => candidate.id !== meal.id), meal];
			selectedMealId = meal.id;
			previewOpen = true;
			addMealOpen = false;
			addMealDate = undefined;
		} catch (error) {
			addMealError = error instanceof Error ? error.message : m.menu_could_not_add_that_recipe();
		} finally {
			addMealBusy = false;
		}
	};

	const previewMeal = (meal: Meal) => {
		if (meal.id === meal.userRecipeId) {
			const recipe = recipes.find(({ id }) => id === meal.userRecipeId);
			if (recipe) void planAndPreview(recipe);
			return;
		}
		selectedMealId = meal.id;
		previewOpen = true;
	};
	const openMealCheckIn = (meal: Meal) => {
		if (meal.id === meal.userRecipeId) return;
		checkInMeal = meal;
		checkInOpen = true;
	};
	const saveMealCheckIn = async (payload: MealCheckInPayload) => {
		if (!onmealcheckin) return;
		replaceMeal(await onmealcheckin(payload));
	};
	const createMeal = (date?: string) => {
		addMealDate = date;
		addMealError = null;
		addMealOpen = true;
	};
	const createRecipeFromTitle = (title: string) => {
		draftRecipe = createDraftRecipe(() => crypto.randomUUID(), title);
		addMealOpen = false;
		recipeEditorOpen = true;
	};
	const saveDraftRecipe = async (recipe: RecipeMenuItem) => {
		if (!oncreaterecipe) return;
		addMealBusy = true;
		addMealError = null;
		try {
			const meal = await oncreaterecipe(recipe, addMealDate);
			scheduleMeals = [...scheduleMeals, meal];
			selectedMealId = meal.id;
			previewOpen = true;
			draftRecipe = null;
		} catch (error) {
			addMealError = error instanceof Error ? error.message : m.menu_could_not_add_that_recipe();
			addMealOpen = true;
		} finally {
			addMealBusy = false;
		}
	};
	const importRecipeFromUrl = async (url: string) => {
		if (!onimporturl) {
			addMealError = 'URL import requires the Maal plan.';
			return;
		}
		addMealBusy = true;
		try {
			const meal = await onimporturl(url, addMealDate);
			scheduleMeals = [...scheduleMeals, meal];
			selectedMealId = meal.id;
			previewOpen = true;
			addMealOpen = false;
		} catch (error) {
			addMealError = error instanceof Error ? error.message : 'Could not import that recipe.';
		} finally {
			addMealBusy = false;
		}
	};

	const startMealDrag = (meal: Meal, event: PointerEvent) => {
		if (draggedMeal) return;
		draggedMeal = meal;
		draggedPointerId = event.pointerId;
		dragX = event.clientX;
		dragY = event.clientY;
		dropTarget = dropTargetFromPointer(event, meal, scheduleMeals);
	};
	const startSecondaryTouchScroll = (event: PointerEvent) => {
		if (!draggedMeal || event.pointerType !== 'touch' || event.pointerId === draggedPointerId)
			return;
		if (secondaryScrollPointerId !== null) return;
		const scrollElement =
			event.target instanceof Element
				? event.target.closest<HTMLElement>('[data-drag-secondary-scroll]')
				: null;
		if (!scrollElement) return;
		secondaryScrollPointerId = event.pointerId;
		secondaryScrollElement = scrollElement;
		secondaryScrollX = event.clientX;
		secondaryScrollY = event.clientY;
	};
	const moveSecondaryTouchScroll = (event: PointerEvent): boolean => {
		if (secondaryScrollPointerId !== event.pointerId || !secondaryScrollElement) return false;
		secondaryScrollElement.scrollLeft -= event.clientX - secondaryScrollX;
		secondaryScrollElement.scrollTop -= event.clientY - secondaryScrollY;
		secondaryScrollX = event.clientX;
		secondaryScrollY = event.clientY;
		event.preventDefault();
		return true;
	};
	const clearSecondaryTouchScroll = (event: PointerEvent): boolean => {
		if (secondaryScrollPointerId !== event.pointerId) return false;
		secondaryScrollPointerId = null;
		secondaryScrollElement = null;
		return true;
	};
	const moveMealDrag = (event: PointerEvent) => {
		if (moveSecondaryTouchScroll(event)) return;
		if (!draggedMeal || draggedPointerId !== event.pointerId) return;
		dragX = event.clientX;
		dragY = event.clientY;
		dropTarget = dropTargetFromPointer(event, draggedMeal, scheduleMeals);
	};
	const updateDraggedMeal = async (target: MealDropTarget) => {
		if (!draggedMeal) return;
		if (draggedMeal.id === draggedMeal.userRecipeId) {
			if (target.kind === 'pool') return;
			const recipe = recipes.find(({ id }) => id === draggedMeal?.userRecipeId);
			if (!recipe || !onplanrecipe) return;
			const meal = await onplanrecipe(recipe, target.date, target);
			scheduleMeals = [...scheduleMeals, meal];
			return;
		}
		const previous = draggedMeal;
		const nextMeals = moveMealToDropTarget(scheduleMeals, draggedMeal, target);
		const changed = nextMeals.filter((meal) => {
			const before = scheduleMeals.find(({ id }) => id === meal.id);
			return (
				before &&
				(before.date !== meal.date ||
					before.time !== meal.time ||
					before.sortOrder !== meal.sortOrder)
			);
		});
		scheduleMeals = nextMeals;
		try {
			for (const meal of changed) await onmealchange?.(meal, previous);
		} catch {
			scheduleMeals = scheduleMeals.map((meal) => (meal.id === previous.id ? previous : meal));
		}
	};
	const stopMealDrag = (event: PointerEvent) => {
		if (clearSecondaryTouchScroll(event)) return;
		if (!draggedMeal || draggedPointerId !== event.pointerId) return;
		if (dropTarget) void updateDraggedMeal(dropTarget);
		draggedMeal = null;
		draggedPointerId = null;
		dropTarget = null;
		secondaryScrollPointerId = null;
		secondaryScrollElement = null;
	};

	const saveMealChange = async (meal: Meal) => {
		const previous = scheduleMeals.find(({ id }) => id === meal.id);
		replaceMeal(meal);
		await onmealchange?.(meal, previous);
	};
	const removeMeal = async (meal: Meal) => {
		scheduleMeals = scheduleMeals.filter(({ id }) => id !== meal.id);
		selectedMealId = null;
		await onmealdelete?.(meal);
	};

	$effect(() => {
		scheduleMeals = [...incomingMeals];
		if (selectedMealId && !incomingMeals.some(({ id }) => id === selectedMealId)) {
			selectedMealId = null;
		}
	});
	$effect(() => {
		void onuistatechange?.({
			scheduleMode: mode,
			scheduleAnchorDate: dateKey(anchorDate),
			dailyScroll
		});
	});
</script>

<svelte:window
	onpointerdown={startSecondaryTouchScroll}
	onpointermove={moveMealDrag}
	onpointerup={stopMealDrag}
	onpointercancel={stopMealDrag}
/>

<section
	bind:clientHeight={dashboardHeight}
	use:keyboardShortcut={{
		target: 'window',
		bindings: [
			{
				id: 'schedule.navigate',
				combo: scheduleShortcutCombos,
				preventDefault: false,
				ignoreRepeat: false,
				handler: handleScheduleShortcut
			}
		]
	}}
	class="flex h-svh min-w-0 flex-col overflow-hidden bg-background text-foreground"
	class:select-none={draggedMeal}
>
	<ScheduleHeader
		{mode}
		{showDateControls}
		{showStepControls}
		onmodechange={(nextMode) => (mode = nextMode)}
		onprevious={previous}
		onnext={next}
		ontoday={today}
	/>

	<div class="min-h-0 min-w-0 flex-1 overflow-hidden">
		{#if mode === 'daily'}
			<ContinuousSchedule
				{mealPool}
				{plannedMeals}
				{showMealPoolImages}
				startDate={anchorDate}
				{todaySignal}
				{dayNavigationSignal}
				{dailyScroll}
				draggingMealId={draggedMeal?.id}
				{draggedMeal}
				{dropTarget}
				onaddmeal={createMeal}
				onpick={startMealDrag}
				onselect={previewMeal}
				oncheckin={openMealCheckIn}
				onscrollstatechange={updateDailyScroll}
				onloadedrangechange={updateRenderedMealRange}
			/>
		{:else if mode === 'multi-day'}
			<MultiDaySchedule
				{mealPool}
				{plannedMeals}
				{showMealPoolImages}
				{anchorDate}
				{weekStartsOn}
				{dayNavigationSignal}
				onvisibledaycountchange={(dayCount) => (multiDayStep = dayCount)}
				draggingMealId={draggedMeal?.id}
				{draggedMeal}
				{dropTarget}
				onaddmeal={createMeal}
				onpick={startMealDrag}
				onselect={previewMeal}
				oncheckin={openMealCheckIn}
				onanchordatechange={updateVisibleAnchor}
				onloadedrangechange={updateRenderedMealRange}
			/>
		{:else}
			<MonthSchedule
				{mealPool}
				{plannedMeals}
				{showMealPoolImages}
				{anchorDate}
				{weekStartsOn}
				draggingMealId={draggedMeal?.id}
				{draggedMeal}
				{dropTarget}
				onaddmeal={createMeal}
				onpick={startMealDrag}
				onselect={previewMeal}
				oncheckin={openMealCheckIn}
				onselectdate={openDay}
				onanchordatechange={updateVisibleAnchor}
				onloadedrangechange={updateRenderedMealRange}
			/>
		{/if}
	</div>

	<MealDragOverlay meal={draggedMeal} x={dragX} y={dragY} />
	<AddMealDialog
		bind:open={addMealOpen}
		date={addMealDate}
		{recipes}
		busy={addMealBusy}
		error={addMealError}
		onexisting={(recipe) => void planAndPreview(recipe)}
		onnewrecipe={createRecipeFromTitle}
		onurl={importRecipeFromUrl}
	/>
	<RecipeEditSheet bind:open={recipeEditorOpen} recipe={draftRecipe} onsaved={saveDraftRecipe} />
	<MealPreviewDialog
		bind:open={previewOpen}
		meal={selectedMeal}
		{householdMembers}
		{unitPreferences}
		onmealchange={(meal) => void saveMealChange(meal)}
		onmealdelete={(meal) => void removeMeal(meal)}
	/>
	<MealCheckInDialog
		bind:open={checkInOpen}
		meal={checkInMeal}
		{currentUserId}
		onsubmit={saveMealCheckIn}
	/>
</section>
