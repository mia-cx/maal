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
	let localSubmitting = $state(false);
	let localError = $state<string | null>(null);
	const isBusy = $derived(busy || localSubmitting);
	const displayError = $derived(error ?? localError);
	const displayedConfirmLabel = $derived(
		isBusy && confirmingLabel ? confirmingLabel : confirmLabel
	);
	const hiddenInputEntries = $derived(
		Object.entries(hiddenInputs).filter((entry): entry is [string, string | number] => {
			const [, value] = entry;
			return value !== null && value !== undefined;
		})
	);

	$effect(() => {
		if (open) return;
		localError = null;
	});

	$effect(() => {
		if (!open || isBusy) return;
		const focusTimeout = window.setTimeout(() => confirmButton?.focus());
		return () => window.clearTimeout(focusTimeout);
	});

	const confirm = async () => {
		if (!onconfirm || localSubmitting) return;
		localSubmitting = true;
		localError = null;
		try {
			await onconfirm();
		} catch (cause) {
			localError = cause instanceof Error ? cause.message : 'Could not complete the request.';
		} finally {
			localSubmitting = false;
		}
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content showCloseButton={false} class={contentClass}>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>

		{#if displayError}
			<p class="text-xs text-destructive">{displayError}</p>
		{/if}

		<div class="flex justify-end gap-2">
			<Button variant="ghost" disabled={isBusy} onclick={() => (open = false)}>{cancelLabel}</Button
			>
			{#if formAction}
				<form method={formMethod} action={formAction}>
					{#each hiddenInputEntries as [name, value] (name)}
						<input type="hidden" {name} value={String(value)} />
					{/each}
					<Button type="submit" variant="destructive" disabled={isBusy} bind:ref={confirmButton}>
						{displayedConfirmLabel}
					</Button>
				</form>
			{:else}
				<Button
					type="button"
					variant="destructive"
					disabled={isBusy}
					bind:ref={confirmButton}
					onclick={confirm}
				>
					{displayedConfirmLabel}
				</Button>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
