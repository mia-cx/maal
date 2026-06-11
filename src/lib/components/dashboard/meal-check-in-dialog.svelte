<script lang="ts">
	import * as Button from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { cn } from '$lib/utils';
	import { mealFeedbackVerdictLabels, type MealFeedbackVerdict } from './meal-labels';
	import type { Meal } from './schedule-types';

	export type MealCheckInPayload = {
		meal: Meal;
		verdict: MealFeedbackVerdict;
		cookTime?: number;
		reason?: string;
	};

	let {
		open = $bindable(false),
		meal,
		onsubmit
	}: {
		open?: boolean;
		meal: Meal | null;
		onsubmit?: (payload: MealCheckInPayload) => void | Promise<void>;
	} = $props();

	let verdict = $state<MealFeedbackVerdict>('repeat');
	let cookTime = $state('');
	let reason = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let lastMealId = $state<string | null>(null);

	const verdicts: MealFeedbackVerdict[] = ['repeat', 'neutral', 'avoid'];

	const reset = () => {
		verdict = 'repeat';
		cookTime = meal?.cookTimeMinutes ? String(meal.cookTimeMinutes) : '';
		reason = '';
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
				verdict,
				cookTime: parsedCookTime(),
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
			<Dialog.Title>Meal check-in</Dialog.Title>
			<Dialog.Description>
				{meal ? `How did ${meal.title} go?` : 'Record how this meal went.'}
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-3">
			<div class="grid gap-1.5">
				<p class="text-xs font-medium">Verdict</p>
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

			<label class="grid gap-1.5 text-xs font-medium">
				Cook time, if you cooked
				<Input bind:value={cookTime} type="text" inputmode="numeric" placeholder="30" />
			</label>

			<label class="grid gap-1.5 text-xs font-medium">
				Notes
				<Textarea bind:value={reason} placeholder="What worked or didn’t?" />
			</label>

			{#if error}
				<p class="text-xs text-destructive">{error}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button.Root type="button" variant="ghost" disabled={busy} onclick={() => (open = false)}>
				Cancel
			</Button.Root>
			<Button.Root type="button" disabled={busy || !meal} onclick={submit}>
				{busy ? 'Saving…' : 'Save check-in'}
			</Button.Root>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
