<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<div class="grid max-w-lg gap-3 text-sm opacity-50 grayscale">
	<p class="text-xs text-muted-foreground">{m.settings_notifications_are_coming_later()}</p>
	<label class="flex cursor-not-allowed items-center justify-between gap-4">
		{m.settings_planning_reminders()}
		<input type="checkbox" class="size-4 accent-primary" disabled />
	</label>
	<label class="flex cursor-not-allowed items-center justify-between gap-4">
		{m.settings_meal_check_ins()}
		<input type="checkbox" class="size-4 accent-primary" disabled />
	</label>
</div>
