<script lang="ts">
	import * as Button from '$lib/components/ui/button';

	let {
		canArchive,
		openArchiveConfirm,
		saveRecipe,
		saveBusy,
		saveError
	}: {
		canArchive: boolean;
		openArchiveConfirm: () => void;
		saveRecipe: () => void;
		saveBusy: boolean;
		saveError: string | null;
	} = $props();
</script>

<div
	class="flex items-center justify-between gap-2 rounded-b-xl border-t border-border bg-popover/95 p-3 backdrop-blur"
>
	<div>
		{#if canArchive}
			<Button.Root variant="destructive" onclick={openArchiveConfirm}>Archive</Button.Root>
		{/if}
	</div>
	<div class="grid justify-items-end gap-1">
		<Button.Root type="button" disabled={saveBusy} onclick={saveRecipe}>
			{saveBusy ? 'Saving…' : 'Save recipe'}
		</Button.Root>
		{#if saveError}
			<p class="text-xs text-destructive">{saveError}</p>
		{/if}
	</div>
</div>
