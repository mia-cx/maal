<script lang="ts">
	import wordmarkUrl from '$lib/assets/Maal.svg';
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	let { class: className, ...restProps }: HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span
	class={cn('wordmark-logo inline-flex shrink-0 bg-current', className)}
	style={`--wordmark-url: url(${wordmarkUrl})`}
	aria-hidden="true"
	{...restProps}
></span>

<style>
	.wordmark-logo {
		aspect-ratio: 1795 / 551;
		mask: var(--wordmark-url) center / contain no-repeat;
	}
</style>
