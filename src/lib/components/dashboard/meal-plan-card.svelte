<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';
	import type {
		Meal,
		MealCardDensity,
		MealFamiliarity,
		MealPickHandler,
		MealSelectHandler
	} from './schedule-types';

	type MealLoad = 'low' | 'medium' | 'high';

	const familiarityLabels: Record<MealFamiliarity, string> = {
		new: 'new',
		exploration: 'explore',
		safe: 'safe',
		survival: 'fallback',
		wildcard: 'wildcard'
	};

	const familiarityLoad: Record<MealFamiliarity, MealLoad> = {
		new: 'medium',
		exploration: 'medium',
		safe: 'low',
		survival: 'low',
		wildcard: 'high'
	};

	const loadAccentClasses: Record<MealLoad, string> = {
		low: 'after:bg-meal-load-low',
		medium: 'after:bg-meal-load-medium',
		high: 'after:bg-meal-load-high'
	};
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
		class?: string;
	} = $props();

	const mealLoad = $derived(meal.familiarity ? familiarityLoad[meal.familiarity] : 'medium');
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
					'pointer-events-none aspect-[3/4] w-14 shrink-0 self-stretch object-cover select-none [-webkit-user-drag:none] @min-[14rem]:w-16 @min-[18rem]:w-20 @min-[24rem]:w-24',
					showAdaptiveImage || showCompactSideImage ? 'block' : 'hidden @min-[14rem]:block'
				)
			: cn(
					'pointer-events-none aspect-[3/2] w-16 shrink-0 self-stretch object-cover select-none [-webkit-user-drag:none] @min-[14rem]:w-20 @min-[24rem]:w-24 @min-[32rem]:w-28',
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
	let longPressTimeout: ReturnType<typeof setTimeout> | undefined;

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

	const wrapperClass = $derived(
		cn(
			'@container min-w-0 touch-none appearance-none border-0 bg-transparent p-0 text-left text-inherit select-none',
			onselect && 'cursor-pointer',
			onpick && !onselect && 'cursor-default',
			hidden && 'opacity-0',
			className
		)
	);
</script>

{#snippet card()}
	<Card.Root
		size="sm"
		class={cn(
			"relative w-full min-w-0 gap-1 overflow-hidden bg-card/50 py-1 shadow-sm ring-1 ring-border/70 after:absolute after:inset-y-0 after:left-0 after:w-0.5 after:content-[''] data-[size=sm]:py-1",
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
			class={cn('min-w-0 px-2.5 py-0', showTopImage && 'pt-1', showSideImage && sideLayoutClass)}
		>
			<div class={cn('min-w-0 flex-1', showSideImage && 'py-1')}>
				<div class="flex min-w-0 items-baseline gap-2">
					<h3 class="min-w-0 flex-1 truncate text-xs leading-tight font-medium">{meal.title}</h3>
					{#if meal.time}
						<time
							class="hidden shrink-0 text-[0.6875rem] leading-tight text-muted-foreground tabular-nums @min-[9rem]:block"
							datetime={meal.time}
						>
							{meal.time}
						</time>
					{/if}
				</div>

				{#if showMetadata}
					<div class="mt-0.5 flex min-w-0 flex-wrap gap-1 overflow-visible">
						{#if meal.cookTimeMinutes}
							<Badge
								variant="outline"
								class="h-4 rounded-sm px-1.5 text-[0.625rem] leading-none tabular-nums"
							>
								{meal.cookTimeMinutes} min
							</Badge>
						{/if}
						{#if meal.familiarity}
							<Badge variant="outline" class="h-4 rounded-sm px-1.5 text-[0.625rem] leading-none">
								{familiarityLabels[meal.familiarity]}
							</Badge>
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
	</Card.Root>
{/snippet}

{#if onselect}
	<button
		type="button"
		aria-label={`Open ${meal.title}`}
		data-meal-card-id={meal.id}
		onpointerdown={startPickupCandidate}
		onpointermove={maybeStartPickup}
		onpointerup={releasePointer}
		onpointercancel={cancelPointer}
		onclick={selectMeal}
		class={wrapperClass}
	>
		{@render card()}
	</button>
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
