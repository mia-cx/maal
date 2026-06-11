<script lang="ts">
	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import { familiarityLabels } from './meal-labels';
	import type {
		Meal,
		MealCardDensity,
		MealCheckInHandler,
		MealPickHandler,
		MealSelectHandler
	} from './schedule-types';

	type MealLoad = 'low' | 'medium' | 'high';

	const familiarityLoadScore: Record<Meal['familiarity'] & string, number> = {
		exploration: 0.55,
		safe: 0.15,
		wildcard: 0.85
	};

	const loadAccentClasses: Record<MealLoad, string> = {
		low: 'after:bg-meal-load-low',
		medium: 'after:bg-meal-load-medium',
		high: 'after:bg-meal-load-high'
	};
	const dayMinutes = 24 * 60;
	const lowCookLoadMinutes = 20;
	const highCookLoadMinutes = 75;
	const defaultDragStartThresholdPx = 6;
	const touchLongPressDelayMs = 420;
	const touchLongPressMoveTolerancePx = 16;

	let {
		meal,
		density = 'summary',
		hidden = false,
		showImage = false,
		imageLayout = 'side',
		imageAspect = 'landscape',
		dragStartThreshold = defaultDragStartThresholdPx,
		onpick,
		onselect,
		oncheckin,
		class: className
	}: {
		meal: Meal;
		density?: MealCardDensity;
		hidden?: boolean;
		showImage?: boolean;
		imageLayout?: 'side' | 'side-compact' | 'top' | 'adaptive';
		imageAspect?: 'landscape' | 'portrait';
		dragStartThreshold?: number;
		onpick?: MealPickHandler;
		onselect?: MealSelectHandler;
		oncheckin?: MealCheckInHandler;
		class?: string;
	} = $props();

	const minutesFromTime = (time: string): number | null => {
		const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time);
		if (!match) return null;
		return Number(match[1]) * 60 + Number(match[2]);
	};

	const timeFromMinutes = (minutes: number): string => {
		const wrappedMinutes = ((minutes % dayMinutes) + dayMinutes) % dayMinutes;
		const hours = Math.floor(wrappedMinutes / 60)
			.toString()
			.padStart(2, '0');
		const remainingMinutes = (wrappedMinutes % 60).toString().padStart(2, '0');
		return `${hours}:${remainingMinutes}`;
	};

	const startCookingTime = (meal: Meal): string | undefined => {
		if (!meal.time) return;
		const duration = meal.adjustedCookTimeMinutes ?? meal.cookTimeMinutes;
		if (!duration) return meal.time;
		const eatingTime = minutesFromTime(meal.time);
		return eatingTime === null ? meal.time : timeFromMinutes(eatingTime - duration);
	};

	const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

	const smoothstep = (edge0: number, edge1: number, value: number): number => {
		const progress = clamp((value - edge0) / (edge1 - edge0));
		return progress * progress * (3 - 2 * progress);
	};

	const cookTimeLoadScore = (meal: Meal): number =>
		smoothstep(
			lowCookLoadMinutes,
			highCookLoadMinutes,
			meal.adjustedCookTimeMinutes ?? meal.cookTimeMinutes ?? lowCookLoadMinutes
		);

	const combinedMentalLoadScore = (meal: Meal): number => {
		const familiarityScore = meal.familiarity ? familiarityLoadScore[meal.familiarity] : 0.45;
		const timeScore = cookTimeLoadScore(meal);
		const independentLoad = 1 - (1 - familiarityScore) ** 0.65 * (1 - timeScore) ** 0.45;
		const interactionLoad = 0.12 * familiarityScore * timeScore;
		return clamp(independentLoad + interactionLoad);
	};

	const mentalLoadLevel = (score: number): MealLoad => {
		if (score < 0.35) return 'low';
		if (score < 0.7) return 'medium';
		return 'high';
	};

	const mealLoad = $derived(mentalLoadLevel(combinedMentalLoadScore(meal)));
	const displayedTime = $derived(startCookingTime(meal));
	const showMetadata = $derived(density !== 'title' && (meal.cookTimeMinutes || meal.familiarity));
	const showDescription = $derived(density === 'detail' && meal.description);
	const showCardImage = $derived(showImage && density !== 'title' && meal.image);
	const showAdaptiveImage = $derived(showCardImage && imageLayout === 'adaptive');
	const showCompactSideImage = $derived(showCardImage && imageLayout === 'side-compact');
	const showTopImage = $derived(
		showCardImage && (imageLayout === 'top' || imageLayout === 'adaptive')
	);
	const showSideImage = $derived(
		showCardImage &&
			(imageLayout === 'side' || imageLayout === 'side-compact' || imageLayout === 'adaptive')
	);
	const topImageClass = $derived(
		cn(
			'pointer-events-none aspect-[2/1] w-full object-cover select-none [-webkit-user-drag:none]',
			showAdaptiveImage && '@max-h-[42rem]/multi-day-column:hidden'
		)
	);
	const sideImageClass = $derived(
		imageAspect === 'portrait'
			? cn(
					'pointer-events-none h-full w-14 shrink-0 self-stretch object-cover select-none [-webkit-user-drag:none] @min-[14rem]:w-16 @min-[18rem]:w-20 @min-[24rem]:w-24',
					showAdaptiveImage || showCompactSideImage ? 'block' : 'hidden @min-[14rem]:block'
				)
			: cn(
					'pointer-events-none h-full w-16 shrink-0 self-stretch object-cover select-none [-webkit-user-drag:none] @min-[14rem]:w-20 @min-[24rem]:w-24 @min-[32rem]:w-28',
					showAdaptiveImage || showCompactSideImage ? 'block' : 'hidden @min-[18rem]:block'
				)
	);
	const sideLayoutClass = $derived(
		imageAspect === 'portrait'
			? cn(
					showAdaptiveImage || showCompactSideImage
						? 'flex items-stretch gap-2 pr-0'
						: '@min-[14rem]:flex @min-[14rem]:items-stretch @min-[14rem]:gap-2 @min-[14rem]:pr-0'
				)
			: cn(
					showAdaptiveImage || showCompactSideImage
						? 'flex items-stretch gap-2 pr-0'
						: '@min-[18rem]:flex @min-[18rem]:items-stretch @min-[18rem]:gap-2 @min-[18rem]:pr-0'
				)
	);

	let pendingPointerId: number | null = null;
	let pendingPointerType: PointerEvent['pointerType'] | null = null;
	let dragStarted = false;
	let suppressClick = false;
	let pointerStartX = 0;
	let pointerStartY = 0;
	let touchScrollLastX = 0;
	let touchScrollLastY = 0;
	let touchScrollElement: HTMLElement | null = null;
	let touchScrollStarted = false;
	let latestPickupEvent: PointerEvent | undefined;
	let currentDate = $state(new Date());
	let longPressTimeout: ReturnType<typeof setTimeout> | undefined;

	const localDateKey = (date: Date): string => {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	};

	const mealCanCheckIn = (meal: Meal, now: Date): boolean => {
		if (!meal.date) return false;
		const today = localDateKey(now);
		if (meal.date < today) return true;
		if (meal.date > today) return false;
		const nowMinutes = now.getHours() * 60 + now.getMinutes();
		const mealMinutes = meal.time ? minutesFromTime(meal.time) : null;
		return nowMinutes >= 18 * 60 || (mealMinutes !== null && mealMinutes <= nowMinutes);
	};

	const showCheckIn = $derived(Boolean(oncheckin && mealCanCheckIn(meal, currentDate)));

	const clearLongPress = () => {
		if (!longPressTimeout) return;
		clearTimeout(longPressTimeout);
		longPressTimeout = undefined;
	};

	const resetPointer = () => {
		clearLongPress();
		pendingPointerId = null;
		pendingPointerType = null;
		dragStarted = false;
		touchScrollElement = null;
		touchScrollStarted = false;
		latestPickupEvent = undefined;
	};

	const releaseCapturedPointer = (event: PointerEvent) => {
		if (
			event.currentTarget instanceof HTMLElement &&
			event.currentTarget.hasPointerCapture(event.pointerId)
		) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};

	const releasePointer = (event: PointerEvent) => {
		if (pendingPointerId !== event.pointerId) return;
		releaseCapturedPointer(event);
		resetPointer();
	};

	const cancelPointer = (event: PointerEvent) => {
		if (pendingPointerId !== event.pointerId) return;
		releaseCapturedPointer(event);
		resetPointer();
	};

	const scrollTouchSource = (event: PointerEvent) => {
		if (!touchScrollElement) return;
		touchScrollElement.scrollLeft -= event.clientX - touchScrollLastX;
		touchScrollElement.scrollTop -= event.clientY - touchScrollLastY;
		touchScrollLastX = event.clientX;
		touchScrollLastY = event.clientY;
	};

	const startTouchLongPress = (event: PointerEvent, target: HTMLElement) => {
		clearLongPress();
		longPressTimeout = setTimeout(() => {
			if (!onpick || pendingPointerId !== event.pointerId || touchScrollStarted) return;
			dragStarted = true;
			suppressClick = true;
			longPressTimeout = undefined;
			target.setPointerCapture(event.pointerId);
			onpick(meal, latestPickupEvent ?? event);
		}, touchLongPressDelayMs);
	};

	const startPickupCandidate = (event: PointerEvent) => {
		if (!onpick || (event.pointerType === 'mouse' && event.button !== 0)) return;
		const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
		if (!target) return;

		if (event.pointerType === 'touch' && !event.isPrimary) return;

		pendingPointerId = event.pointerId;
		pendingPointerType = event.pointerType;
		dragStarted = false;
		pointerStartX = event.clientX;
		pointerStartY = event.clientY;
		touchScrollLastX = event.clientX;
		touchScrollLastY = event.clientY;
		latestPickupEvent = event;

		if (event.pointerType === 'touch') {
			touchScrollElement = target.closest<HTMLElement>('[data-drag-secondary-scroll]');
			target.setPointerCapture(event.pointerId);
			startTouchLongPress(event, target);
			return;
		}

		target.setPointerCapture(event.pointerId);
	};

	const maybeStartPickup = (event: PointerEvent) => {
		if (!onpick || pendingPointerId !== event.pointerId) return;
		const distance = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY);

		if (pendingPointerType === 'touch') {
			if (dragStarted) {
				latestPickupEvent = event;
				event.preventDefault();
				return;
			}

			if (touchScrollStarted || distance > touchLongPressMoveTolerancePx) {
				clearLongPress();
				touchScrollStarted = true;
				suppressClick = true;
				scrollTouchSource(event);
				event.preventDefault();
				return;
			}

			latestPickupEvent = event;
			return;
		}

		if (dragStarted || distance < dragStartThreshold) return;
		dragStarted = true;
		suppressClick = true;
		event.preventDefault();
		event.stopPropagation();
		onpick(meal, event);
	};

	const selectMeal = (event: MouseEvent) => {
		if (suppressClick) {
			suppressClick = false;
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		onselect?.(meal);
	};

	const checkIn = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		oncheckin?.(meal);
	};

	const selectMealFromKeyboard = (event: KeyboardEvent) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		onselect?.(meal);
	};

	const wrapperClass = $derived(
		cn(
			'@container min-w-0 touch-none appearance-none border-0 bg-transparent p-0 text-left text-inherit select-none',
			onselect && 'cursor-pointer',
			onpick && !onselect && 'cursor-default',
			hidden && 'opacity-0',
			className
		)
	);

	$effect(() => {
		const interval = setInterval(() => {
			currentDate = new Date();
		}, 60_000);
		return () => clearInterval(interval);
	});
</script>

{#snippet card()}
	<Card.Root
		size="sm"
		class={cn(
			"relative h-full w-full min-w-0 gap-1 overflow-hidden bg-card/50 py-1 shadow-sm ring-1 ring-border/70 after:absolute after:inset-y-0 after:left-0 after:w-1 after:content-[''] data-[size=sm]:py-1",
			showTopImage && 'pt-0',
			showSideImage && 'py-0 data-[size=sm]:py-0',
			showAdaptiveImage &&
				'@min-h-[42rem]/multi-day-column:py-1 @min-h-[42rem]/multi-day-column:data-[size=sm]:py-1',
			loadAccentClasses[mealLoad]
		)}
	>
		{#if showTopImage}
			<img
				src={meal.image}
				alt=""
				loading="lazy"
				draggable="false"
				data-meal-card-thumbnail=""
				class={topImageClass}
			/>
		{/if}

		<div
			class={cn(
				'min-w-0 px-2.5 py-0',
				showTopImage && 'pt-1',
				showSideImage && 'h-full',
				showSideImage && sideLayoutClass
			)}
		>
			<div
				class={cn(
					'@container/meal-card-body min-w-0 flex-1',
					showSideImage && 'flex flex-col justify-start py-2'
				)}
			>
				<div class="flex min-w-0 items-baseline gap-2">
					<p class="min-w-0 flex-1 truncate text-xs leading-tight font-medium">{meal.title}</p>
					{#if displayedTime}
						<time
							class="hidden shrink-0 text-[0.6875rem] leading-tight text-muted-foreground tabular-nums @min-[12rem]:block"
							datetime={displayedTime}
						>
							{displayedTime}
						</time>
					{/if}
				</div>

				{#if showMetadata}
					<div
						class="mt-0.5 grid min-w-0 gap-0.5 overflow-visible text-[0.6875rem] leading-tight text-muted-foreground @min-[28ch]/meal-card-body:flex @min-[28ch]/meal-card-body:flex-wrap @min-[28ch]/meal-card-body:items-center @min-[28ch]/meal-card-body:gap-x-1.5 @min-[28ch]/meal-card-body:gap-y-0.5"
					>
						{#if meal.cookTimeMinutes}
							<span class="inline-flex min-w-0 items-center gap-1 tabular-nums">
								<TimerIcon class="size-3 shrink-0" />
								<span>{meal.cookTimeMinutes} min</span>
							</span>
						{/if}
						{#if meal.cookTimeMinutes && meal.familiarity}
							<span
								aria-hidden="true"
								class="hidden text-muted-foreground/60 @min-[28ch]/meal-card-body:inline"
							>
								•
							</span>
						{/if}
						{#if meal.familiarity}
							<span class="inline-flex min-w-0 items-center gap-1">
								<SparklesIcon class="size-3 shrink-0" />
								<span>{familiarityLabels[meal.familiarity]}</span>
							</span>
						{/if}
					</div>
				{/if}

				{#if showDescription}
					<p class="mt-1.5 line-clamp-3 text-[0.6875rem] leading-snug text-muted-foreground">
						{meal.description}
					</p>
				{/if}
			</div>

			{#if showSideImage}
				<img
					src={meal.image}
					alt=""
					loading="lazy"
					draggable="false"
					data-meal-card-thumbnail=""
					class={sideImageClass}
				/>
			{/if}
		</div>

		{#if showCheckIn}
			<Button.Root
				type="button"
				variant="outline"
				size={density === 'title' ? 'xs' : 'sm'}
				class="mx-2 mb-1 w-[calc(100%-1rem)]"
				onpointerdown={(event) => event.stopPropagation()}
				onclick={checkIn}
			>
				Check in
			</Button.Root>
		{/if}
	</Card.Root>
{/snippet}

{#if onselect}
	<div
		role="button"
		tabindex="0"
		aria-label={`Open ${meal.title}`}
		data-meal-card-id={meal.id}
		onpointerdown={startPickupCandidate}
		onpointermove={maybeStartPickup}
		onpointerup={releasePointer}
		onpointercancel={cancelPointer}
		onclick={selectMeal}
		onkeydown={selectMealFromKeyboard}
		class={wrapperClass}
	>
		{@render card()}
	</div>
{:else}
	<div
		role="presentation"
		data-meal-card-id={meal.id}
		onpointerdown={startPickupCandidate}
		onpointermove={maybeStartPickup}
		onpointerup={releasePointer}
		onpointercancel={cancelPointer}
		class={wrapperClass}
	>
		{@render card()}
	</div>
{/if}
