<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import type { RecipeMenuItem } from '$lib/components/menu/menu-types';

	type PickerOption =
		| { id: string; type: 'existing'; recipe: RecipeMenuItem }
		| { id: string; type: 'new'; title: string }
		| { id: string; type: 'url'; url: string };

	let {
		open = $bindable(false),
		date,
		recipes,
		busy = false,
		error,
		onexisting,
		onnewrecipe,
		onurl
	}: {
		open?: boolean;
		date?: string;
		recipes: RecipeMenuItem[];
		busy?: boolean;
		error?: string | null;
		onexisting?: (recipe: RecipeMenuItem) => void;
		onnewrecipe?: (title: string) => void;
		onurl?: (url: string) => void;
	} = $props();

	let query = $state('');
	let activeIndex = $state(0);
	let activeQuery = $state('');

	const normalizedQuery = $derived(query.trim());
	const isUrl = $derived(/^https?:\/\//i.test(normalizedQuery));
	const normalizedSearch = $derived(normalizedQuery.toLowerCase());
	const dialogTitle = $derived(date ? 'Add meal' : 'Add recipe');
	const dialogDescription = $derived(
		date
			? 'Choose a saved recipe, import one from a URL, or start a new recipe for this day.'
			: 'Choose a saved recipe, import one from a URL, or start a new recipe for your menu.'
	);

	const wordScore = (recipe: RecipeMenuItem, search: string): number => {
		if (!search) return 1;
		const title = recipe.title.toLowerCase();
		if (title === search) return 100;
		if (title.startsWith(search)) return 80;
		if (title.includes(search)) return 60;
		const words = search.split(/\s+/).filter(Boolean);
		const matchedWords = words.filter((word) => title.includes(word)).length;
		if (!matchedWords) return 0;
		return 20 + matchedWords * 10;
	};

	const matches = $derived(
		recipes
			.map((recipe) => ({ recipe, score: wordScore(recipe, normalizedSearch) }))
			.filter((candidate) => candidate.score > 0)
			.sort(
				(left, right) =>
					right.score - left.score || left.recipe.title.localeCompare(right.recipe.title)
			)
			.slice(0, 8)
			.map((candidate) => candidate.recipe)
	);

	const options = $derived.by((): PickerOption[] => {
		if (isUrl) return [{ id: 'url-import', type: 'url', url: normalizedQuery }];
		return [
			...matches.map((recipe) => ({
				id: `recipe-${recipe.id}`,
				type: 'existing' as const,
				recipe
			})),
			...(normalizedQuery
				? [{ id: 'new-recipe', type: 'new' as const, title: normalizedQuery }]
				: [])
		];
	});

	const optionClass = (index: number) =>
		`w-full cursor-pointer rounded-sm px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none disabled:cursor-default disabled:opacity-60 ${
			activeIndex === index ? 'bg-muted text-foreground' : 'hover:bg-muted'
		}`;

	const reset = () => {
		query = '';
		activeIndex = 0;
		activeQuery = '';
	};

	const chooseExisting = (recipe: RecipeMenuItem) => {
		onexisting?.(recipe);
		open = false;
		reset();
	};

	const createNewRecipe = (title = normalizedQuery) => {
		if (!title || isUrl) return;
		onnewrecipe?.(title);
	};

	const importUrl = (url = normalizedQuery) => {
		if (!/^https?:\/\//i.test(url)) return;
		onurl?.(url);
	};

	const chooseOption = (option: PickerOption | undefined) => {
		if (!option || busy) return;
		if (option.type === 'existing') {
			chooseExisting(option.recipe);
			return;
		}
		if (option.type === 'new') {
			createNewRecipe(option.title);
			return;
		}
		importUrl(option.url);
	};

	const handleInputKeydown = (event: KeyboardEvent) => {
		if (event.isComposing || !options.length) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			activeIndex = Math.min(activeIndex + 1, options.length - 1);
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			chooseOption(options[activeIndex]);
		}
	};

	$effect(() => {
		if (!open) {
			reset();
			return;
		}
		if (activeQuery !== normalizedQuery) {
			activeQuery = normalizedQuery;
			activeIndex = 0;
			return;
		}
		if (!options.length) {
			activeIndex = 0;
			return;
		}
		activeIndex = Math.min(Math.max(activeIndex, 0), options.length - 1);
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="gap-0 overflow-hidden p-0 sm:max-w-lg">
		<Dialog.Header class="border-b border-border px-4 py-3">
			<Dialog.Title>{dialogTitle}</Dialog.Title>
			<Dialog.Description>{dialogDescription}</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-3 p-4">
			<Input
				bind:value={query}
				type={isUrl ? 'url' : 'text'}
				autocomplete="off"
				placeholder="Recipe name or https://…"
				class="h-9"
				disabled={busy}
				onkeydown={handleInputKeydown}
			/>

			<div
				class="max-h-72 overflow-y-auto rounded-md border border-border bg-background p-1"
				role="listbox"
				aria-label="Recipe options"
			>
				{#if !isUrl && matches.length === 0}
					<p class="px-3 py-2 text-sm text-muted-foreground">No saved recipes match.</p>
				{/if}
				{#each options as option, index (option.id)}
					{#if option.type === 'existing'}
						<button
							type="button"
							role="option"
							aria-selected={activeIndex === index}
							class={`${optionClass(index)} grid gap-0.5`}
							disabled={busy}
							onpointerenter={() => (activeIndex = index)}
							onclick={() => chooseOption(option)}
						>
							<span class="truncate text-sm font-medium">{option.recipe.title}</span>
							<span class="truncate text-xs text-muted-foreground">
								{option.recipe.sourceSiteName ?? option.recipe.sourceUrl ?? 'Saved recipe'}
							</span>
						</button>
					{:else if option.type === 'new'}
						{#if matches.length > 0}
							<div class="my-1 border-t border-border"></div>
						{/if}
						<button
							type="button"
							role="option"
							aria-selected={activeIndex === index}
							class={`${optionClass(index)} flex items-center justify-between gap-3 text-sm`}
							disabled={busy}
							onpointerenter={() => (activeIndex = index)}
							onclick={() => chooseOption(option)}
						>
							<span class="min-w-0 truncate">New recipe: {option.title}</span>
							<span class="shrink-0 text-xs text-muted-foreground">Create</span>
						</button>
					{:else}
						<button
							type="button"
							role="option"
							aria-selected={activeIndex === index}
							class={`${optionClass(index)} flex items-center justify-between gap-3 text-sm`}
							disabled={busy}
							onpointerenter={() => (activeIndex = index)}
							onclick={() => chooseOption(option)}
						>
							<span class="min-w-0 truncate">Import recipe from URL</span>
							<span class="shrink-0 text-xs text-muted-foreground">schema.org</span>
						</button>
					{/if}
				{/each}
			</div>

			{#if error}
				<p class="text-xs text-destructive">{error}</p>
			{/if}
			{#if busy}
				<p class="text-xs text-muted-foreground">Working…</p>
			{/if}

			<div class="flex justify-end">
				<Button variant="outline" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
