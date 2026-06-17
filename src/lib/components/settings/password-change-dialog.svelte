<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	let {
		open = $bindable(false),
		currentPassword = $bindable(''),
		newPassword = $bindable(''),
		confirmPassword = $bindable(''),
		passwordMessage,
		passwordError,
		passwordChangeBusy,
		changePassword
	}: {
		open: boolean;
		currentPassword: string;
		newPassword: string;
		confirmPassword: string;
		passwordMessage: string | null;
		passwordError: string | null;
		passwordChangeBusy: boolean;
		changePassword: () => void | Promise<void>;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[24rem]">
		<Dialog.Header>
			<Dialog.Title>{m.settings_change_password()}</Dialog.Title>
			<Dialog.Description
				>{m.settings_enter_your_current_password_before_choosing_()}</Dialog.Description
			>
		</Dialog.Header>
		<div class="grid gap-3">
			<label class="grid gap-1 text-xs font-medium">
				{m.settings_current_password()}
				<Input
					bind:value={currentPassword}
					type="password"
					autocomplete="current-password"
					class="h-8"
				/>
			</label>
			<label class="grid gap-1 text-xs font-medium">
				{m.settings_new_password()}
				<Input bind:value={newPassword} type="password" autocomplete="new-password" class="h-8" />
			</label>
			<label class="grid gap-1 text-xs font-medium">
				{m.settings_confirm_new_password()}
				<Input
					bind:value={confirmPassword}
					type="password"
					autocomplete="new-password"
					class="h-8"
				/>
			</label>
			{#if passwordMessage}<p class="text-xs text-muted-foreground">{passwordMessage}</p>{/if}
			{#if passwordError}<p class="text-xs text-destructive">{passwordError}</p>{/if}
			<div class="flex justify-end gap-2">
				<Button variant="ghost" disabled={passwordChangeBusy} onclick={() => (open = false)}>
					{m.settings_cancel()}
				</Button>
				<Button
					disabled={passwordChangeBusy || !currentPassword || !newPassword || !confirmPassword}
					onclick={changePassword}
				>
					{passwordChangeBusy ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
