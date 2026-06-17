export const defaultSettingsCategory = 'account';
import type { SettingsCategoryId } from './types';

export const settingsCategories = [
	'account',
	'security',
	'mcp',
	'notifications',
	'billing'
] as const satisfies SettingsCategoryId[];

export const isSettingsCategory = (value: string): value is SettingsCategoryId =>
	settingsCategories.includes(value as SettingsCategoryId);

export const settingsRedirectPath = (
	category: SettingsCategoryId = defaultSettingsCategory
): string => `/plan?${new URLSearchParams({ settings: category }).toString()}`;
