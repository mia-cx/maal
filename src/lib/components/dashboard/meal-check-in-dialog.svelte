<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import * as Button from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { cn } from '$lib/utils';
	import { mealFeedbackVerdictLabels } from './meal-labels';
	import type { MealFeedbackVerdict } from '$lib/domain/meal-feedback';
	import type { Meal } from './schedule-types';

	export type MealCheckInPayload = {
		meal: Meal;
		cooked: boolean;
		verdict: MealFeedbackVerdict;
		cookTime?: number;
		reason?: string;
	};

	let {
		open = $bindable(false),
		meal,
		currentUserId,
		onsubmit
	}: {
		open?: boolean;
		meal: Meal | null;
		currentUserId?: string;
		onsubmit?: (payload: MealCheckInPayload) => void | Promise<void>;
	} = $props();

	let cooked = $state(true);
	let verdict = $state<MealFeedbackVerdict>('repeat');
	let cookTime = $state('');
	let reason = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let lastMealId = $state<string | null>(null);

	const verdicts: MealFeedbackVerdict[] = ['repeat', 'neutral', 'avoid'];
	const canReportCookTime = $derived(
		Boolean(meal?.plannedCookWorkosUserId && currentUserId === meal.plannedCookWorkosUserId)
	);

	const reset = () => {
		cooked = meal?.latestCheckIn ? meal.status === 'cooked' : true;
		verdict = meal?.latestCheckIn?.verdict ?? 'repeat';
		cookTime = String(meal?.latestCheckIn?.cookTime ?? meal?.cookTimeMinutes ?? '');
		reason = meal?.latestCheckIn?.reason ?? '';
		busy = false;
		error = null;
	};

	const parsedCookTime = (): number | undefined => {
		const value = Number(cookTime.trim());
		return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
	};

	const submit = async () => {
		if (!meal || !onsubmit) return;
		busy = true;
		error = null;
		try {
			await onsubmit({
				meal,
				cooked,
				verdict,
				cookTime: cooked && canReportCookTime ? parsedCookTime() : undefined,
				reason: reason.trim() || undefined
			});
			open = false;
		} catch (submitError) {
			error = submitError instanceof Error ? submitError.message : 'Could not save check-in.';
		} finally {
			busy = false;
		}
	};

	$effect(() => {
		if (!open) return;
		const nextMealId = meal?.id ?? null;
		if (nextMealId === lastMealId) return;
		lastMealId = nextMealId;
		reset();
	});

	$effect(() => {
		if (open) return;
		lastMealId = null;
		error = null;
		busy = false;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[24rem]">
		<Dialog.Header>
			<Dialog.Title>{m.plan_meal_check_in()}</Dialog.Title>
			<Dialog.Description>
				{meal ? `How did ${meal.title} go?` : 'Record how this meal went.'}
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-3">
			<div class="grid gap-1.5">
				<p class="text-xs font-medium">{m.plan_was_this_meal_cooked_and_eaten()}</p>
				<div class="grid grid-cols-2 gap-1">
					<Button.Root
						type="button"
						variant={cooked ? 'default' : 'outline'}
						class="h-auto min-h-8 px-1.5 text-center whitespace-normal"
						onclick={() => (cooked = true)}
					>
						{m.plan_cooked_eaten()}
					</Button.Root>
					<Button.Root
						type="button"
						variant={!cooked ? 'default' : 'outline'}
						class="h-auto min-h-8 px-1.5 text-center whitespace-normal"
						onclick={() => (cooked = false)}
					>
						{m.plan_skipped()}
					</Button.Root>
				</div>
			</div>

			<div class="grid gap-1.5">
				<p class="text-xs font-medium">{m.plan_verdict()}</p>
				<div class="grid grid-cols-3 gap-1">
					{#each verdicts as option (option)}
						<Button.Root
							type="button"
							variant={verdict === option ? 'default' : 'outline'}
							class={cn('h-auto min-h-8 px-1.5 text-center whitespace-normal')}
							onclick={() => (verdict = option)}
						>
							{mealFeedbackVerdictLabels[option]}
						</Button.Root>
					{/each}
				</div>
			</div>

			{#if canReportCookTime}
				<label class="grid gap-1.5 text-xs font-medium">
					{m.plan_how_long_did_it_take_to_cook_this_meal()}
					<Input
						bind:value={cookTime}
						type="text"
						inputmode="numeric"
						placeholder={m.plan_default_cook_minutes()}
						disabled={!cooked}
					/>
				</label>
			{/if}

			<label class="grid gap-1.5 text-xs font-medium">
				{m.plan_notes()}
				<Textarea bind:value={reason} placeholder={m.plan_what_worked_or_didn_t()} />
			</label>

			{#if error}
				<p class="text-xs text-destructive">{error}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button.Root type="button" variant="ghost" disabled={busy} onclick={() => (open = false)}>
				{m.settings_cancel()}
			</Button.Root>
			<Button.Root type="button" disabled={busy || !meal} onclick={submit}>
				{busy ? 'Saving…' : 'Save check-in'}
			</Button.Root>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
