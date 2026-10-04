import type { SettingsCategoryId } from './types.js';

export const defaultSettingsCategory: SettingsCategoryId = 'account';
export const settingsRouteCategories = [
	'account',
	'security',
	'mcp',
	'notifications',
	'billing'
] as const satisfies readonly SettingsCategoryId[];

export const isSettingsCategory = (value: string): value is SettingsCategoryId =>
	settingsRouteCategories.includes(value as SettingsCategoryId);

export const settingsRedirectPath = (
	category: SettingsCategoryId = defaultSettingsCategory
): string => `/plan?${new URLSearchParams({ settings: category }).toString()}`;
