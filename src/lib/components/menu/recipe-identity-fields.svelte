<script lang="ts">
	import * as m from '$lib/paraglide/messages';
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
		canImportFromUrl,
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
		canImportFromUrl: boolean;
		sourceUrlCanImport: boolean;
		importBusy: boolean;
		importError: string | null;
		importSourceUrl: () => void;
	} = $props();
</script>

<div class="grid gap-4">
	<label class="grid gap-1 text-xs font-medium">
		{m.menu_title()}
		<Input bind:value={title} />
	</label>

	<label class="grid gap-1 text-xs font-medium">
		{m.menu_source_url()}
		<div class="flex gap-2">
			<Input bind:value={sourceUrl} />
			{#if canImportFromUrl}
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
		{#if canImportFromUrl && sourceUrlCanImport}
			<span class="text-muted-foreground">
				{m.menu_import_will_fill_this_sheet_from_schema_org_()}
			</span>
		{/if}
		{#if importError}
			<span class="text-destructive">{importError}</span>
		{/if}
	</label>

	<div class="grid gap-3 sm:grid-cols-2">
		<label class="grid gap-1 text-xs font-medium">
			{m.menu_source_site()}
			<Input bind:value={sourceSiteName} />
		</label>
		<label class="grid gap-1 text-xs font-medium">
			{m.menu_author()}
			<Input bind:value={sourceAuthorName} />
		</label>
		<label class="grid gap-1 text-xs font-medium">
			{m.menu_publisher()}
			<Input bind:value={sourcePublisherName} />
		</label>
		<label class="grid gap-1 text-xs font-medium">
			{m.menu_based_on_url()}
			<Input bind:value={sourceIsBasedOnUrl} />
		</label>
	</div>

	<label class="grid gap-1 text-xs font-medium">
		{m.menu_description()}
		<textarea bind:value={description} rows="4" class={textareaClass}></textarea>
	</label>

	<label class="grid gap-1 text-xs font-medium">
		{m.menu_image_url()}
		<Input bind:value={image} />
	</label>

	<div class="grid gap-3 sm:grid-cols-3">
		<label class="grid gap-1 text-xs font-medium">
			{m.menu_prep_minutes()}
			<Input type="number" min="0" bind:value={prepTimeMinutes} />
		</label>
		<label class="grid gap-1 text-xs font-medium">
			{m.menu_cook_minutes()}
			<Input type="number" min="0" bind:value={cookTimeMinutes} />
		</label>
		<label class="grid gap-1 text-xs font-medium">
			{m.menu_yield()}
			<Input type="number" min="1" step="1" bind:value={recipeYield} />
		</label>
	</div>
</div>
