<script lang="ts">
	import { keyboardShortcut } from '$lib/actions/keyboard-shortcut';
	import {
		addScheduleMealFromRecipe,
		deleteScheduleMeal,
		hydrateScheduleMeals,
		mergeHydratedScheduleMeals,
		moveScheduleMealToDropTarget,
		scheduleMealStore,
		selectScheduleMeal,
		selectedMealStore,
		updateScheduleMealSchedule
	} from '$lib/stores/schedule-meals';
	import { createMenuRecipe, hydrateMenuRecipes, menuRecipesStore } from '$lib/stores/menu-recipes';
	import { setDailyScroll, uiState, updateUiState } from '$lib/stores/ui-state';
	import AddMealDialog from './add-meal-dialog.svelte';
	import ContinuousSchedule from './continuous-schedule.svelte';
	import RecipeEditSheet from '$lib/components/menu/recipe-edit-sheet.svelte';
	import MealCheckInDialog, { type MealCheckInPayload } from './meal-check-in-dialog.svelte';
	import MealDragOverlay from './meal-drag-overlay.svelte';
	import MealPreviewDialog from './meal-preview-dialog.svelte';
	import MonthSchedule from './month-schedule.svelte';
	import MultiDaySchedule from './multi-day-schedule.svelte';
	import ScheduleHeader from './schedule-header.svelte';
	import { addDays, addMonths, dateFromKey, dateKey, startOfDay } from './schedule-date';
	import { dropTargetFromPointer } from './schedule-dnd';
	import { isMealInPool, sortMealPool } from './schedule-ordering';
	import type { RecipeMenuItem } from '$lib/components/menu/menu-types';
	import type { HouseholdMember, Meal, MealDropTarget, ScheduleMode } from './schedule-types';

	let {
		meals: initialMeals = [],
		recipes: initialRecipes = [],
		defaultMealServings = 1,
		weekStartsOn = 'monday',
		initialMealRange,
		currentUserId,
		householdMembers = []
	}: {
		meals?: Meal[];
		recipes?: RecipeMenuItem[];
		defaultMealServings?: number;
		weekStartsOn?: 'sunday' | 'monday';
		initialMealRange?: { start: string; end: string };
		currentUserId?: string;
		householdMembers?: HouseholdMember[];
	} = $props();

	const initialUiState = uiState.get();
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
	let loadedMealRanges = $state<{ start: string; end: string }[]>([]);
	let loadingMealRangeKey = $state('');
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

	const hasLoadedMealRange = (start: string, end: string): boolean =>
		loadedMealRanges.some((range) => range.start <= start && range.end >= end);

	const nextDateKey = (key: string): string => dateKey(addDays(dateFromKey(key), 1));
	const previousDateKey = (key: string): string => dateKey(addDays(dateFromKey(key), -1));

	const missingMealRanges = (range: { start: string; end: string }) => {
		let cursor = range.start;
		const missing: { start: string; end: string }[] = [];
		const overlappingRanges = loadedMealRanges
			.filter((loadedRange) => loadedRange.end >= range.start && loadedRange.start <= range.end)
			.toSorted((left, right) => left.start.localeCompare(right.start));

		for (const loadedRange of overlappingRanges) {
			if (loadedRange.start > cursor) {
				missing.push({ start: cursor, end: previousDateKey(loadedRange.start) });
			}
			if (loadedRange.end >= cursor) cursor = nextDateKey(loadedRange.end);
			if (cursor > range.end) break;
		}
		if (cursor <= range.end) missing.push({ start: cursor, end: range.end });
		return missing;
	};

	const loadMealRangeSegment = async (range: { start: string; end: string }) => {
		const key = `${range.start}:${range.end}`;
		if (loadingMealRangeKey === key) return;
		loadingMealRangeKey = key;
		try {
			const response = await fetch(`/plan/meals?start=${range.start}&end=${range.end}`);
			if (!response.ok) throw new Error(await response.text());
			const body = (await response.json()) as { meals: Meal[] };
			mergeHydratedScheduleMeals(body.meals, range.start, range.end);
			loadedMealRanges = [...loadedMealRanges, { start: range.start, end: range.end }];
		} catch (error) {
			console.error('Failed to load meal range', error);
		} finally {
			if (loadingMealRangeKey === key) loadingMealRangeKey = '';
		}
	};

	const loadMealRange = async (range: { start: string; end: string }) => {
		if (hasLoadedMealRange(range.start, range.end) || loadingMealRangeKey) return;
		for (const missingRange of missingMealRanges(range)) {
			await loadMealRangeSegment(missingRange);
		}
	};

	const updateRenderedMealRange = (range: { start: string; end: string }) => {
		if (renderedMealRange?.start === range.start && renderedMealRange.end === range.end) return;
		renderedMealRange = range;
	};

	const visibleMealCards = (): HTMLElement[] =>
		Array.from(document.querySelectorAll<HTMLElement>('[data-meal-card-id]')).filter((card) => {
			const rect = card.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0 && getComputedStyle(card).visibility !== 'hidden';
		});

	const focusMealCard = (activeCard: HTMLElement, direction: 'left' | 'right' | 'up' | 'down') => {
		const activeRect = activeCard.getBoundingClientRect();
		const activeX = activeRect.left + activeRect.width / 2;
		const activeY = activeRect.top + activeRect.height / 2;
		const horizontal = direction === 'left' || direction === 'right';
		const forward = direction === 'right' || direction === 'down';

		const nextCard = visibleMealCards()
			.filter((card) => card !== activeCard)
			.map((card) => {
				const rect = card.getBoundingClientRect();
				const x = rect.left + rect.width / 2;
				const y = rect.top + rect.height / 2;
				const primaryDelta = horizontal
					? forward
						? x - activeX
						: activeX - x
					: forward
						? y - activeY
						: activeY - y;
				const crossDelta = horizontal ? Math.abs(y - activeY) : Math.abs(x - activeX);
				return { card, primaryDelta, score: primaryDelta + crossDelta * 1.5 };
			})
			.filter((candidate) => candidate.primaryDelta > 2)
			.sort((left, right) => left.score - right.score)[0]?.card;

		if (!nextCard) return;
		nextCard.focus({ preventScroll: true });
		nextCard.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
	};

	const moveByDay = (dayDelta: number) => {
		anchorDate = startOfDay(addDays(anchorDate, dayDelta));
		dayNavigationSignal += 1;
		if (mode !== 'daily') return;
		dailyScroll = null;
		updateUiState({ dailyScroll: null });
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
		const cardDirectionByKey: Record<string, 'left' | 'right' | 'up' | 'down'> = {
			ArrowLeft: 'left',
			ArrowRight: 'right',
			ArrowUp: 'up',
			ArrowDown: 'down',
			h: 'left',
			l: 'right',
			k: 'up',
			j: 'down'
		};
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
		updateUiState({ dailyScroll: null });
		todaySignal += 1;
	};

	const openDay = (date: Date) => {
		anchorDate = startOfDay(date);
		dailyScroll = null;
		updateUiState({ dailyScroll: null });
		mode = 'daily';
	};

	const updateDailyScroll = (scrollState: NonNullable<typeof dailyScroll>) => {
		dailyScroll = scrollState;
		setDailyScroll(scrollState);
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

	const saveMealCheckIn = async ({
		meal,
		cooked,
		verdict,
		cookTime,
		reason
	}: MealCheckInPayload) => {
		const response = await fetch('/plan/check-ins', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ mealId: meal.id, cooked, verdict, cookTime, reason })
		});
		if (!response.ok) throw new Error(await response.text());
		updateScheduleMealSchedule(
			{
				...meal,
				status: cooked ? 'cooked' : 'skipped',
				latestVerdict: verdict,
				latestCheckIn: { verdict, cookTime, reason: reason?.trim() || undefined }
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
		const meal = addScheduleMealFromRecipe(recipe, addMealDate, defaultMealServings);
		selectScheduleMeal(meal.id);
		previewOpen = true;
		addMealOpen = false;
		addMealDate = undefined;
	};

	const readAddMealError = (error: unknown): string => {
		if (error instanceof Error) return error.message;
		return 'Could not add that recipe.';
	};

	const draftRecipeFromTitle = (title: string): RecipeMenuItem => ({
		id: `draft-recipe-${crypto.randomUUID()}`,
		title,
		description: '',
		ingredientCount: 0,
		appliances: [],
		timesCooked: 0,
		plannedCount: 0,
		reviewSummary: {
			worthRepeating: 0,
			neutral: 0,
			neverAgain: 0,
			notes: []
		},
		ingredients: [{ amount: '', item: '' }],
		instructions: [{ position: 1, text: '' }]
	});

	const createRecipeFromTitle = (title: string) => {
		draftRecipe = draftRecipeFromTitle(title);
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
		const signature = initialMeals.map((meal) => meal.id).join('|');
		if (signature === hydratedMealsSignature) return;
		hydratedMealsSignature = signature;
		hydrateScheduleMeals(initialMeals);
		loadedMealRanges = initialMealRange ? [initialMealRange] : [];
	});

	$effect(() => {
		const signature = initialRecipes.map((recipe) => recipe.id).join('|');
		if (signature === hydratedRecipesSignature) return;
		hydratedRecipesSignature = signature;
		hydrateMenuRecipes(initialRecipes);
	});

	$effect(() => {
		if (!renderedMealRange) return;
		void loadMealRange(renderedMealRange);
	});

	$effect(() => {
		updateUiState({ scheduleMode: mode, scheduleAnchorDate: dateKey(anchorDate) });
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
		recipes={menuRecipes}
		busy={addMealBusy}
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
