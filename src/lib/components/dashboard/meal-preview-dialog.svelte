<script lang="ts">
	import * as Calendar from '$lib/components/ui/calendar';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import XIcon from '@lucide/svelte/icons/x';
	import * as Popover from '$lib/components/ui/popover';
	import { Separator } from '$lib/components/ui/separator';
	import { parseDate, type DateValue } from '@internationalized/date';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Meal, MealFamiliarity } from './schedule-types';

	const fallbackDurationMinutes = 30;

	const familiarityLabels: Record<MealFamiliarity, string> = {
		new: 'New option',
		exploration: 'Exploration',
		safe: 'Safe option',
		survival: 'Fallback',
		wildcard: 'Wildcard'
	};

	const familiarityTone: Record<MealFamiliarity, string> = {
		new: 'border-meal-load-medium/40 bg-meal-load-medium/10 text-foreground',
		exploration: 'border-meal-load-medium/40 bg-meal-load-medium/10 text-foreground',
		safe: 'border-meal-load-low/40 bg-meal-load-low/10 text-foreground',
		survival: 'border-meal-load-low/40 bg-meal-load-low/10 text-foreground',
		wildcard: 'border-meal-load-high/40 bg-meal-load-high/10 text-foreground'
	};

	let {
		meal,
		open = $bindable(false)
	}: {
		meal: Meal | null;
		open?: boolean;
	} = $props();

	let lastMealId = $state<string | null>(null);
	let scheduledDate = $state('');
	let scheduledDateValue = $state<DateValue | undefined>();
	let startCookingTime = $state('');
	let startEatingTime = $state('');
	let scheduleEditorOpen = $state(false);

	const ingredients = $derived(meal?.ingredients ?? []);
	const instructions = $derived(meal?.instructions ?? []);
	const cookTimeMinutes = $derived(meal?.cookTimeMinutes ?? fallbackDurationMinutes);
	const adjustedCookTimeMinutes = $derived(meal?.adjustedCookTimeMinutes ?? cookTimeMinutes);
	const familiarityLabel = $derived(
		meal?.familiarity ? familiarityLabels[meal.familiarity] : 'Option'
	);
	const familiarityClass = $derived(
		meal?.familiarity
			? familiarityTone[meal.familiarity]
			: 'border-border bg-muted/40 text-foreground'
	);

	const dateFormatter = new Intl.DateTimeFormat('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});

	const formatDuration = (minutes: number): string => {
		if (minutes < 60) return `${minutes} min`;
		const hours = Math.floor(minutes / 60);
		const remainder = minutes % 60;
		return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
	};

	const normalizeTimeToMinute = (time: string): string => {
		const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time);
		return match ? `${match[1]}:${match[2]}` : time;
	};

	const minutesFromTime = (time: string): number | null => {
		const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time);
		if (!match) return null;
		return Number(match[1]) * 60 + Number(match[2]);
	};

	const timeFromMinutes = (minutes: number): string => {
		const dayMinutes = 24 * 60;
		const wrappedMinutes = ((minutes % dayMinutes) + dayMinutes) % dayMinutes;
		const hours = Math.floor(wrappedMinutes / 60)
			.toString()
			.padStart(2, '0');
		const remainingMinutes = (wrappedMinutes % 60).toString().padStart(2, '0');
		return `${hours}:${remainingMinutes}`;
	};

	const timeOffset = (time: string, minutes: number): string => {
		const parsedTime = minutesFromTime(time);
		return parsedTime === null ? '' : timeFromMinutes(parsedTime + minutes);
	};

	const syncScheduledDateValue = (date: string) => {
		scheduledDateValue = date ? parseDate(date) : undefined;
	};

	const updateStartEating = (time: string) => {
		const minuteTime = normalizeTimeToMinute(time);
		startEatingTime = minuteTime;
		startCookingTime = timeOffset(minuteTime, -adjustedCookTimeMinutes);
	};

	const updateStartCooking = (time: string) => {
		const minuteTime = normalizeTimeToMinute(time);
		startCookingTime = minuteTime;
		startEatingTime = timeOffset(minuteTime, adjustedCookTimeMinutes);
	};

	const dateFromInput = (date: string): Date | null => {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
		if (!match) return null;
		return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	};

	const scheduleSummary = $derived.by(() => {
		if (!scheduledDate || !startCookingTime || !startEatingTime) return 'Choose a date and time';
		const date = dateFromInput(scheduledDate);
		if (!date) return 'Choose a date and time';
		return `${dateFormatter.format(date)}, ${startCookingTime}-${startEatingTime}`;
	});

	$effect(() => {
		const nextDate = scheduledDateValue?.toString() ?? '';
		if (nextDate && nextDate !== scheduledDate) scheduledDate = nextDate;
	});

	$effect(() => {
		const nextMealId = meal?.id ?? null;
		if (nextMealId === lastMealId) return;
		lastMealId = nextMealId;
		scheduleEditorOpen = false;
		scheduledDate = meal?.date ?? '';
		syncScheduledDateValue(scheduledDate);
		startEatingTime = meal?.time ? normalizeTimeToMinute(meal.time) : '';
		startCookingTime = meal?.time ? timeOffset(meal.time, -adjustedCookTimeMinutes) : '';
	});
</script>

{#snippet scheduleEditorControls()}
	<Calendar.Calendar bind:value={scheduledDateValue} class="mx-auto p-0" />
	<Separator class="my-2" />
	<div class="grid gap-2 sm:grid-cols-2">
		<label class="grid gap-1">
			<span class="text-xs font-medium text-muted-foreground">Start cooking</span>
			<Input
				type="time"
				value={startCookingTime}
				oninput={(event) => updateStartCooking(event.currentTarget.value)}
				class="h-9 px-3 tabular-nums"
			/>
		</label>
		<label class="grid gap-1">
			<span class="text-xs font-medium text-muted-foreground">Start eating</span>
			<Input
				type="time"
				value={startEatingTime}
				oninput={(event) => updateStartEating(event.currentTarget.value)}
				class="h-9 px-3 tabular-nums"
			/>
		</label>
	</div>
{/snippet}

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay />
		<DialogPrimitive.Content
			class="fixed inset-0 z-50 h-svh w-full [scrollbar-width:none] overflow-y-auto bg-transparent p-0 outline-none [&::-webkit-scrollbar]:hidden"
		>
			{#if meal}
				<button
					type="button"
					aria-label="Close meal preview"
					tabindex="-1"
					class="fixed inset-0 z-0 cursor-default bg-transparent"
					onclick={() => (open = false)}
				></button>
				<div
					class="relative z-10 mx-auto flex min-h-svh w-full max-w-[min(100vw-1rem,42rem)] flex-col px-2 sm:max-w-2xl sm:px-4"
				>
					<button
						type="button"
						aria-label="Close meal preview"
						tabindex="-1"
						class="h-[26svh] w-full shrink-0 cursor-default bg-transparent"
						onclick={() => (open = false)}
					></button>
					<div
						class="relative min-h-[74svh] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl ring-1 ring-foreground/10"
					>
						<Dialog.Close
							aria-label="Close meal preview"
							class="absolute top-3 right-3 z-20 inline-flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-md bg-black text-white shadow-lg transition after:absolute after:inset-0 after:bg-white/20 after:opacity-0 after:transition-opacity after:content-[''] hover:after:opacity-100 focus-visible:ring-2 focus-visible:ring-black/60 focus-visible:outline-none dark:bg-white dark:text-black dark:after:bg-black/20 dark:focus-visible:ring-white/60"
						>
							<XIcon class="relative z-10 size-5" />
						</Dialog.Close>

						{#if meal.image}
							<img
								src={meal.image}
								alt={meal.title}
								class="h-[min(42svh,24rem)] w-full object-cover"
							/>
						{/if}

						<section class="px-5 py-5">
							<Dialog.Header class="pr-8 sm:pr-10">
								<div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
									<Dialog.Title
										class="min-w-0 text-4xl leading-tight font-semibold tracking-tight sm:text-2xl"
									>
										{meal.title}
									</Dialog.Title>
									<div
										class={`inline-flex w-fit shrink-0 items-center rounded-sm border px-2 py-1 text-xs leading-none font-semibold ${familiarityClass}`}
									>
										{familiarityLabel}
									</div>
								</div>
							</Dialog.Header>

							<div class="mt-3 space-y-4">
								{#if meal.description}
									<Dialog.Description class="text-sm leading-relaxed text-foreground">
										{meal.description}
									</Dialog.Description>
								{/if}

								<div class="space-y-2 text-sm leading-relaxed">
									<p>
										<span class="font-medium">Cook time:</span>
										<span class="tabular-nums">{formatDuration(cookTimeMinutes)}</span>
										<span class="mx-1 text-muted-foreground">•</span>
										<span class="font-medium">Adjusted:</span>
										<span class="tabular-nums">{formatDuration(adjustedCookTimeMinutes)}</span>
									</p>

									<div>
										<button
											type="button"
											aria-expanded={scheduleEditorOpen}
											class="w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-left text-sm font-medium tabular-nums hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:hidden"
											onclick={() => (scheduleEditorOpen = true)}
										>
											{scheduleSummary}
										</button>

										<Popover.Root bind:open={scheduleEditorOpen}>
											<Popover.Trigger
												class="hidden w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-left text-sm font-medium tabular-nums hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:block"
											>
												{scheduleSummary}
											</Popover.Trigger>
											<Popover.Content
												align="center"
												side="bottom"
												sideOffset={8}
												class="hidden w-fit max-w-[calc(100vw-2rem)] border border-border sm:flex"
											>
												{@render scheduleEditorControls()}
											</Popover.Content>
										</Popover.Root>
									</div>
								</div>
							</div>
						</section>

						<div class="space-y-4 px-5 pb-5">
							<Separator />

							<section class="min-w-0">
								<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
									Ingredients
								</h3>
								{#if ingredients.length > 0}
									<ul class="mt-3 space-y-2 text-sm leading-snug">
										{#each ingredients as ingredient (ingredient)}
											<li class="flex gap-2">
												<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-meal-load-medium"
												></span>
												<span>{ingredient}</span>
											</li>
										{/each}
									</ul>
								{:else}
									<p class="mt-3 text-sm text-muted-foreground">Ingredients are not saved yet.</p>
								{/if}
							</section>

							<section class="min-w-0">
								<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
									Instructions
								</h3>
								{#if instructions.length > 0}
									<ol class="mt-3 space-y-3 text-sm leading-relaxed">
										{#each instructions as instruction, index (instruction)}
											<li class="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
												<span
													class="flex size-6 items-center justify-center rounded-sm bg-muted text-xs font-medium text-muted-foreground tabular-nums"
												>
													{index + 1}
												</span>
												<span>{instruction}</span>
											</li>
										{/each}
									</ol>
								{:else}
									<p class="mt-3 text-sm text-muted-foreground">Instructions are not saved yet.</p>
								{/if}
							</section>
						</div>
					</div>
					{#if scheduleEditorOpen}
						<button
							type="button"
							aria-label="Close schedule editor"
							class="fixed inset-0 z-[70] bg-background/55 backdrop-blur-[1px] sm:hidden"
							onclick={() => (scheduleEditorOpen = false)}
						></button>
						<section
							aria-label="Edit schedule"
							class="fixed inset-x-0 bottom-0 z-[80] max-h-[82svh] overflow-y-auto rounded-t-xl border border-border bg-popover px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-popover-foreground shadow-2xl ring-1 ring-foreground/10 sm:hidden"
						>
							<div class="mx-auto mb-3 h-1.5 w-16 rounded-full bg-muted-foreground/25"></div>
							<div class="mb-3 flex items-center justify-between gap-3">
								<div class="min-w-0">
									<h3 class="text-sm font-semibold">Schedule meal</h3>
									<p class="truncate text-xs text-muted-foreground">{scheduleSummary}</p>
								</div>
								<button
									type="button"
									class="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
									onclick={() => (scheduleEditorOpen = false)}
								>
									Done
								</button>
							</div>
							{@render scheduleEditorControls()}
						</section>
					{/if}
				</div>
			{/if}
		</DialogPrimitive.Content>
	</Dialog.Portal>
</Dialog.Root>
