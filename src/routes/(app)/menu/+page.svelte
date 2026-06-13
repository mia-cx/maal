<script lang="ts">
	import MyMenuDashboard from '$lib/components/menu/my-menu-dashboard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<MyMenuDashboard
	recipes={data.recipes}
	archivedRecipes={data.archivedRecipes}
	nextRecipeOffset={data.nextRecipeOffset}
/>
