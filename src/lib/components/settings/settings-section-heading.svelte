<script lang="ts">
	import type { SettingsCategory } from '$lib/settings/categories';

	let { category }: { category: SettingsCategory } = $props();
</script>

<div class="mb-4 flex items-center gap-2">
	<category.icon class="size-4" />
	<h2 class="text-sm font-medium">{category.label()}</h2>
</div>
