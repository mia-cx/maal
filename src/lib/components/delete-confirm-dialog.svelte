<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';

	type HiddenInputs = Record<string, string | number | null | undefined>;

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel = 'Delete',
		confirmingLabel,
		cancelLabel = 'Cancel',
		busy = false,
		error = null,
		formAction,
		formMethod = 'post',
		hiddenInputs = {},
		onconfirm,
		contentClass = 'sm:max-w-[22rem]'
	}: {
		open?: boolean;
		title: string;
		description: string;
		confirmLabel?: string;
		confirmingLabel?: string;
		cancelLabel?: string;
		busy?: boolean;
		error?: string | null;
		formAction?: string;
		formMethod?: 'get' | 'post';
		hiddenInputs?: HiddenInputs;
		onconfirm?: () => void | Promise<void>;
		contentClass?: string;
	} = $props();

	let confirmButton = $state<HTMLButtonElement | null>(null);
	const displayedConfirmLabel = $derived(busy && confirmingLabel ? confirmingLabel : confirmLabel);
	const hiddenInputEntries = $derived(
		Object.entries(hiddenInputs).filter((entry): entry is [string, string | number] => {
			const [, value] = entry;
			return value !== null && value !== undefined;
		})
	);

	$effect(() => {
		if (!open || busy) return;
		setTimeout(() => confirmButton?.focus());
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content showCloseButton={false} class={contentClass}>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>

		{#if error}
			<p class="text-xs text-destructive">{error}</p>
		{/if}

		<div class="flex justify-end gap-2">
			<Button variant="ghost" disabled={busy} onclick={() => (open = false)}>{cancelLabel}</Button>
			{#if formAction}
				<form method={formMethod} action={formAction}>
					{#each hiddenInputEntries as [name, value] (name)}
						<input type="hidden" {name} value={String(value)} />
					{/each}
					<Button type="submit" variant="destructive" disabled={busy} bind:ref={confirmButton}>
						{displayedConfirmLabel}
					</Button>
				</form>
			{:else}
				<Button
					type="button"
					variant="destructive"
					disabled={busy}
					bind:ref={confirmButton}
					onclick={() => void onconfirm?.()}
				>
					{displayedConfirmLabel}
				</Button>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
