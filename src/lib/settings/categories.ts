import * as m from '$lib/paraglide/messages';
import BellIcon from '@lucide/svelte/icons/bell';
import CreditCardIcon from '@lucide/svelte/icons/credit-card';
import KeyRoundIcon from '@lucide/svelte/icons/key-round';
import LockKeyholeIcon from '@lucide/svelte/icons/lock-keyhole';
import UserRoundIcon from '@lucide/svelte/icons/user-round';
import type { Component } from 'svelte';
import type { SettingsCategoryId } from './types';

export type SettingsCategory = {
	id: SettingsCategoryId;
	label: string;
	icon: Component;
	disabled?: boolean;
};

export const settingsCategories: SettingsCategory[] = [
	{ id: 'account', label: m.settings_account(), icon: UserRoundIcon },
	{ id: 'security', label: m.settings_security(), icon: LockKeyholeIcon },
	{ id: 'mcp', label: m.settings_mcp_keys(), icon: KeyRoundIcon },
	{ id: 'notifications', label: m.settings_notifications(), icon: BellIcon, disabled: true },
	{ id: 'billing', label: m.settings_billing(), icon: CreditCardIcon }
];

export const settingsCategoryFromParam = (value: string | null): SettingsCategoryId | null => {
	if (!value) return null;
	return settingsCategories.some((category) => category.id === value)
		? (value as SettingsCategoryId)
		: 'account';
};
