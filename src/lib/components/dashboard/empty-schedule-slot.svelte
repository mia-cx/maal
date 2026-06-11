<script lang="ts">
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
	No meals planned.
</button>
