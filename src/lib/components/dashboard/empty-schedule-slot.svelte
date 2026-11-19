<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { MealAddHandler } from './schedule-types';

	let { date, onaddmeal }: { date?: string; onaddmeal?: MealAddHandler } = $props();

	const addMeal = (event: MouseEvent) => {
		event.stopPropagation();
		onaddmeal?.(date);
	};
</script>

<button
	type="button"
	class="rounded-sm pl-2.5 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
	ondblclick={addMeal}
>
	{m.app_no_meals_planned()}
</button>
