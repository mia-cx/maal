<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { untrack } from 'svelte';
	import { keyboardShortcut } from '$lib/actions/keyboard-shortcut';
	import {
		addScheduleMealFromRecipe,
		deleteScheduleMeal,
		hydrateScheduleMeals,
		hydrateScheduleMealsFromDexie,
		moveScheduleMealToDropTarget,
		scheduleMealStore,
		selectScheduleMeal,
		selectedMealStore,
		updateScheduleMealSchedule
	} from '$lib/stores/schedule-meals';
	import {
		createMenuRecipe,
		hydrateMenuRecipes,
		hydrateMenuRecipesFromDexie,
		menuRecipesStore
	} from '$lib/stores/menu-recipes';
	import { searchRecipesInDexie } from '$lib/client-db/repositories';
	import { createDraftRecipe } from '$lib/menu/recipe-draft';
	import {
		clearScheduleDailyScroll,
		scheduleUiState,
		setScheduleDailyScroll,
		updateScheduleUiState
	} from '$lib/stores/schedule-ui-state';
	import AddMealDialog from './add-meal-dialog.svelte';
	import ContinuousSchedule from './continuous-schedule.svelte';
	import { RecipeEditSheet, type RecipeMenuItem } from '$lib/components/menu';
	import MealCheckInDialog, { type MealCheckInPayload } from './meal-check-in-dialog.svelte';
	import MealDragOverlay from './meal-drag-overlay.svelte';
	import MealPreviewDialog from './meal-preview-dialog.svelte';
	import MonthSchedule from './month-schedule.svelte';
	import MultiDaySchedule from './multi-day-schedule.svelte';
	import ScheduleHeader from './schedule-header.svelte';
	import { addDays, addMonths, dateFromKey, dateKey, startOfDay } from './schedule-date';
	import { dropTargetFromPointer } from './schedule-dnd';
	import { isMealInPool, sortMealPool } from './schedule-ordering';
	import { cardDirectionByKey, focusMealCard } from './schedule-keyboard';
	import { hasLoadedMealRange, missingMealRanges, type MealRange } from './schedule-ranges';
	import type { UnitPreferences } from '$lib/recipes/ingredient-text';
	import type { HouseholdMember, Meal, MealDropTarget, ScheduleMode } from './schedule-types';

	let {
		meals: initialMeals = [],
		recipes: initialRecipes = [],
		defaultMealServings = 1,
		weekStartsOn = 'monday',
		initialMealRange,
		currentUserId,
		householdMembers = [],
		unitPreferences = {}
	}: {
		meals?: Meal[];
		recipes?: RecipeMenuItem[];
		defaultMealServings?: number;
		weekStartsOn?: 'sunday' | 'monday';
		initialMealRange?: { start: string; end: string };
		currentUserId?: string;
		householdMembers?: HouseholdMember[];
		unitPreferences?: UnitPreferences;
	} = $props();

	const initialUiState = scheduleUiState.get();
	const mealPoolImageMinHeight = 760;

	let mode = $state<ScheduleMode>(initialUiState.scheduleMode);
	let anchorDate = $state(dateFromKey(initialUiState.scheduleAnchorDate));
	let dailyScroll = $state(initialUiState.dailyScroll);
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
	let pickerRecipesLoading = $state(false);
	let pickerRecipesLoaded = $state(false);
	let recipeEditorOpen = $state(false);
	let draftRecipe = $state<RecipeMenuItem | null>(null);
	let dragX = $state(0);
	let dragY = $state(0);
	let dropTarget = $state<MealDropTarget | null>(null);
	let secondaryScrollPointerId: number | null = null;
	let secondaryScrollElement: HTMLElement | null = null;
	let secondaryScrollX = 0;
	let secondaryScrollY = 0;
	let hydratedMealsSignature = $state('');
	let hydratedRecipesSignature = $state('');
	let loadedMealRanges = $state<MealRange[]>([]);
	let loadingMealRangeKey = $state('');
	let pendingMealRange = $state<MealRange | null>(null);
	let mealRangeError = $state<string | null>(null);
	let renderedMealRange = $state<{ start: string; end: string } | null>(null);

	const mealPool = $derived(sortMealPool($scheduleMealStore.filter(isMealInPool)));
	const plannedMeals = $derived($scheduleMealStore.filter((meal) => !isMealInPool(meal)));
	const selectedMeal = $derived($selectedMealStore);
	const menuRecipes = $derived($menuRecipesStore);
	const showDateControls = $derived(mode === 'daily' || mode === 'multi-day' || mode === 'monthly');
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

	const loadMealRangeSegment = async (range: MealRange) => {
		const key = `${range.start}:${range.end}`;
		if (loadingMealRangeKey === key) return;
		loadingMealRangeKey = key;
		try {
			mealRangeError = null;
			await hydrateScheduleMealsFromDexie();
			loadedMealRanges = [...loadedMealRanges, { start: range.start, end: range.end }];
		} finally {
			if (loadingMealRangeKey === key) loadingMealRangeKey = '';
		}
	};

	const loadMealRange = async (range: MealRange) => {
		if (hasLoadedMealRange(loadedMealRanges, range.start, range.end)) return;
		if (loadingMealRangeKey) {
			pendingMealRange = range;
			return;
		}
		try {
			for (const missingRange of missingMealRanges(loadedMealRanges, range)) {
				await loadMealRangeSegment(missingRange);
			}
		} finally {
			const pendingRange = pendingMealRange;
			pendingMealRange = null;
			if (
				pendingRange &&
				!hasLoadedMealRange(loadedMealRanges, pendingRange.start, pendingRange.end)
			) {
				void loadMealRange(pendingRange);
			}
		}
	};

	const loadPickerRecipes = async () => {
		if (pickerRecipesLoaded || pickerRecipesLoading || $menuRecipesStore.length > 0) return;
		const cached = await hydrateMenuRecipesFromDexie();
		if (cached.recipes.length) {
			pickerRecipesLoaded = true;
			return;
		}
		pickerRecipesLoading = true;
		try {
			hydrateMenuRecipes(await searchRecipesInDexie('', 60));
			pickerRecipesLoaded = true;
		} catch (error) {
			addMealError = error instanceof Error ? error.message : 'Could not load recipes.';
		} finally {
			pickerRecipesLoading = false;
		}
	};

	const updateRenderedMealRange = (range: { start: string; end: string }) => {
		if (renderedMealRange?.start === range.start && renderedMealRange.end === range.end) return;
		renderedMealRange = range;
	};

	const moveByDay = (dayDelta: number) => {
		anchorDate = startOfDay(addDays(anchorDate, dayDelta));
		dayNavigationSignal += 1;
		if (mode !== 'daily') return;
		dailyScroll = null;
		clearScheduleDailyScroll();
	};

	const moveByMonthRow = (rowDelta: number): boolean => {
		if (mode !== 'monthly') return false;
		anchorDate = startOfDay(addDays(anchorDate, rowDelta * 7));
		return true;
	};

	const scheduleShortcutsEnabled = () =>
		!previewOpen && !recipeEditorOpen && !addMealOpen && !checkInOpen;

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
		if (!nextMode || nextMode === mode) return;
		event.preventDefault();
		mode = nextMode;
	};

	const previous = () => {
		anchorDate =
			mode === 'multi-day' ? addDays(anchorDate, -multiDayStep) : addMonths(anchorDate, -1);
	};

	const next = () => {
		anchorDate =
			mode === 'multi-day' ? addDays(anchorDate, multiDayStep) : addMonths(anchorDate, 1);
	};

	const today = () => {
		anchorDate = startOfDay(new Date());
		dailyScroll = null;
		clearScheduleDailyScroll();
		todaySignal += 1;
	};

	const openDay = (date: Date) => {
		anchorDate = startOfDay(date);
		dailyScroll = null;
		clearScheduleDailyScroll();
		mode = 'daily';
	};

	const updateDailyScroll = (scrollState: NonNullable<typeof dailyScroll>) => {
		dailyScroll = scrollState;
		setScheduleDailyScroll(scrollState);
	};

	const updateVisibleAnchor = (date: Date) => {
		anchorDate = startOfDay(date);
	};

	const previewMeal = (meal: Meal) => {
		selectScheduleMeal(meal.id);
		previewOpen = true;
	};

	const openMealCheckIn = (meal: Meal) => {
		checkInMeal = meal;
		checkInOpen = true;
	};

	const saveMealCheckIn = async (payload: MealCheckInPayload) => {
		updateScheduleMealSchedule(
			{
				...payload.meal,
				status: payload.cooked ? 'cooked' : 'skipped',
				latestVerdict: payload.verdict,
				latestCheckIn: {
					verdict: payload.verdict,
					cookTime: payload.cookTime,
					reason: payload.reason?.trim() || undefined
				}
			},
			'external'
		);
	};

	const createMeal = (date?: string) => {
		addMealDate = date;
		addMealError = null;
		addMealOpen = true;
	};

	const previewAddedRecipe = (recipe: RecipeMenuItem) => {
		const meal = addScheduleMealFromRecipe(
			recipe,
			addMealDate,
			defaultMealServings,
			unitPreferences
		);
		selectScheduleMeal(meal.id);
		previewOpen = true;
		addMealOpen = false;
		addMealDate = undefined;
	};

	const readAddMealError = (error: unknown): string => {
		if (error instanceof Error) return error.message;
		return m.menu_could_not_add_that_recipe();
	};

	const createRecipeFromTitle = (title: string) => {
		draftRecipe = createDraftRecipe(() => crypto.randomUUID(), title);
		addMealOpen = false;
		recipeEditorOpen = true;
	};

	const saveDraftRecipe = async (recipe: RecipeMenuItem) => {
		addMealBusy = true;
		addMealError = null;
		try {
			previewAddedRecipe(await createMenuRecipe({ recipe }));
			draftRecipe = null;
		} catch (error) {
			addMealError = readAddMealError(error);
			addMealOpen = true;
		} finally {
			addMealBusy = false;
		}
	};

	const importRecipeFromUrl = async (url: string) => {
		addMealBusy = true;
		addMealError = null;
		try {
			previewAddedRecipe(await createMenuRecipe({ url }));
		} catch (error) {
			addMealError = readAddMealError(error);
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
		dropTarget = dropTargetFromPointer(event, meal, $scheduleMealStore);
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
		dropTarget = dropTargetFromPointer(event, draggedMeal, $scheduleMealStore);
	};

	const updateDraggedMeal = (target: MealDropTarget) => {
		if (!draggedMeal) return;
		moveScheduleMealToDropTarget(draggedMeal, target, defaultMealServings);
	};

	const stopMealDrag = (event: PointerEvent) => {
		if (clearSecondaryTouchScroll(event)) return;
		if (!draggedMeal || draggedPointerId !== event.pointerId) return;
		if (dropTarget) updateDraggedMeal(dropTarget);
		draggedMeal = null;
		draggedPointerId = null;
		dropTarget = null;
		secondaryScrollPointerId = null;
		secondaryScrollElement = null;
	};

	$effect(() => {
		void hydrateScheduleMealsFromDexie();
		void hydrateMenuRecipesFromDexie();
	});

	$effect(() => {
		if (!initialMeals.length) return;
		const signature = initialMeals.map((meal) => meal.id).join('|');
		if (signature === hydratedMealsSignature) return;
		hydratedMealsSignature = signature;
		hydrateScheduleMeals(initialMeals);
		loadedMealRanges = initialMealRange ? [initialMealRange] : [];
	});

	$effect(() => {
		if (!initialRecipes.length) return;
		const signature = initialRecipes.map((recipe) => recipe.id).join('|');
		if (signature === hydratedRecipesSignature) return;
		hydratedRecipesSignature = signature;
		hydrateMenuRecipes(initialRecipes);
	});

	$effect(() => {
		const range = renderedMealRange;
		if (!range) return;
		untrack(() => {
			void loadMealRange(range);
		});
	});

	$effect(() => {
		if (!addMealOpen) return;
		untrack(() => {
			void loadPickerRecipes();
		});
	});

	$effect(() => {
		updateScheduleUiState({ scheduleMode: mode, scheduleAnchorDate: dateKey(anchorDate) });
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
				when: scheduleShortcutsEnabled,
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

	{#if mealRangeError}
		<div class="border-b border-border bg-secondary px-4 py-2 text-sm text-muted-foreground">
			{mealRangeError}
		</div>
	{/if}

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
		recipes={menuRecipes}
		busy={addMealBusy || pickerRecipesLoading}
		error={addMealError}
		onexisting={previewAddedRecipe}
		onnewrecipe={createRecipeFromTitle}
		onurl={importRecipeFromUrl}
	/>
	<RecipeEditSheet bind:open={recipeEditorOpen} recipe={draftRecipe} onsaved={saveDraftRecipe} />
	<MealPreviewDialog
		bind:open={previewOpen}
		meal={selectedMeal}
		{householdMembers}
		{unitPreferences}
		onmealchange={updateScheduleMealSchedule}
		onmealdelete={deleteScheduleMeal}
	/>
	<MealCheckInDialog
		bind:open={checkInOpen}
		meal={checkInMeal}
		{currentUserId}
		onsubmit={saveMealCheckIn}
	/>
</section>
