<script lang="ts">
	import * as InputOTP from '$lib/components/ui/input-otp';

	let {
		value = $bindable(''),
		length,
		disabled = false,
		label = 'Verification code',
		class: className = 'gap-1.5'
	}: {
		value: string;
		length: number;
		disabled?: boolean;
		label?: string;
		class?: string;
	} = $props();
</script>

<InputOTP.Root maxlength={length} bind:value {disabled} aria-label={label} class={className}>
	{#snippet children({ cells })}
		<InputOTP.Group>
			{#each cells as cell, index (index)}
				<InputOTP.Slot {cell} />
			{/each}
		</InputOTP.Group>
	{/snippet}
</InputOTP.Root>
