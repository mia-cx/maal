<script lang="ts">
	import * as Button from '$lib/components/ui/button';

	let {
		canArchive,
		openArchiveConfirm,
		saveRecipe
	}: {
		canArchive: boolean;
		openArchiveConfirm: () => void;
		saveRecipe: () => void;
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
	<Button.Root type="button" onclick={saveRecipe}>Save recipe</Button.Root>
</div>
