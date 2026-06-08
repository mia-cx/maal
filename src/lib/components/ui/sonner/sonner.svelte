<script lang="ts">
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';
	import { mode } from 'mode-watcher';
	import { SpinnerIcon } from '$lib/components/icons/solar-outline';
	import { CheckCircleIcon } from '$lib/components/icons/solar-outline';
	import { XCircleIcon } from '$lib/components/icons/solar-outline';
	import { InfoIcon } from '$lib/components/icons/solar-outline';
	import { WarningIcon } from '$lib/components/icons/solar-outline';

	let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
	theme={mode.current}
	class="toaster group"
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border);"
	{...restProps}
>
	{#snippet loadingIcon()}
		<SpinnerIcon class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CheckCircleIcon class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<XCircleIcon class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<WarningIcon class="size-4" />
	{/snippet}
</Sonner>
