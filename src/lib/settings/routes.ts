export const defaultSettingsCategory = 'account';
export const settingsCategories = ['account', 'security', 'notifications', 'billing'] as const;
export type SettingsCategoryId = (typeof settingsCategories)[number];

export const isSettingsCategory = (value: string): value is SettingsCategoryId =>
	settingsCategories.includes(value as SettingsCategoryId);

export const settingsRedirectPath = (category: SettingsCategoryId = defaultSettingsCategory): string =>
	`/plan?${new URLSearchParams({ settings: category }).toString()}`;
