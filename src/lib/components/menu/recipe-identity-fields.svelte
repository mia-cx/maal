<script lang="ts">
	import * as Button from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	let {
		title = $bindable(''),
		sourceUrl = $bindable(''),
		sourceSiteName = $bindable(''),
		sourceAuthorName = $bindable(''),
		sourcePublisherName = $bindable(''),
		sourceIsBasedOnUrl = $bindable(''),
		description = $bindable(''),
		image = $bindable(''),
		prepTimeMinutes = $bindable(''),
		cookTimeMinutes = $bindable(''),
		recipeYield = $bindable(''),
		textareaClass,
		onimporturl,
		sourceUrlCanImport,
		importBusy,
		importError,
		importSourceUrl
	}: {
		title: string;
		sourceUrl: string;
		sourceSiteName: string;
		sourceAuthorName: string;
		sourcePublisherName: string;
		sourceIsBasedOnUrl: string;
		description: string;
		image: string;
		prepTimeMinutes: string;
		cookTimeMinutes: string;
		recipeYield: string;
		textareaClass: string;
		onimporturl?: unknown;
		sourceUrlCanImport: boolean;
		importBusy: boolean;
		importError: string | null;
		importSourceUrl: () => void;
	} = $props();
</script>

<div class="grid gap-4">
	<label class="grid gap-1 text-xs font-medium">
		Title
		<Input bind:value={title} />
	</label>

	<label class="grid gap-1 text-xs font-medium">
		Source URL
		<div class="flex gap-2">
			<Input bind:value={sourceUrl} />
			{#if onimporturl}
				<Button.Root
					type="button"
					variant="outline"
					disabled={!sourceUrlCanImport || importBusy}
					onclick={importSourceUrl}
				>
					{importBusy ? 'Importing…' : 'Import'}
				</Button.Root>
			{/if}
		</div>
		{#if onimporturl && sourceUrlCanImport}
			<span class="text-muted-foreground">
				Import will fill this sheet from schema.org recipe data before you save.
			</span>
		{/if}
		{#if importError}
			<span class="text-destructive">{importError}</span>
		{/if}
	</label>

	<div class="grid gap-3 sm:grid-cols-2">
		<label class="grid gap-1 text-xs font-medium">
			Source site
			<Input bind:value={sourceSiteName} />
		</label>
		<label class="grid gap-1 text-xs font-medium">
			Author
			<Input bind:value={sourceAuthorName} />
		</label>
		<label class="grid gap-1 text-xs font-medium">
			Publisher
			<Input bind:value={sourcePublisherName} />
		</label>
		<label class="grid gap-1 text-xs font-medium">
			Based on URL
			<Input bind:value={sourceIsBasedOnUrl} />
		</label>
	</div>

	<label class="grid gap-1 text-xs font-medium">
		Description
		<textarea bind:value={description} rows="4" class={textareaClass}></textarea>
	</label>

	<label class="grid gap-1 text-xs font-medium">
		Image URL
		<Input bind:value={image} />
	</label>

	<div class="grid gap-3 sm:grid-cols-3">
		<label class="grid gap-1 text-xs font-medium">
			Prep minutes
			<Input type="number" min="0" bind:value={prepTimeMinutes} />
		</label>
		<label class="grid gap-1 text-xs font-medium">
			Cook minutes
			<Input type="number" min="0" bind:value={cookTimeMinutes} />
		</label>
		<label class="grid gap-1 text-xs font-medium">
			Yield
			<Input type="number" min="1" step="1" bind:value={recipeYield} />
		</label>
	</div>
</div>
