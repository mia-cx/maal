export const weekStartDays = ['sunday', 'monday'] as const;
export const defaultLocale = 'en-US';
export const defaultTimezone = 'UTC';
export const maxHouseholdNameLength = 120;
export const inviteExpiryDays = [1, 7, 30] as const;

export type WeekStartDay = (typeof weekStartDays)[number];

export const asWeekStartDay = (value: FormDataEntryValue | null): WeekStartDay => {
	const raw = typeof value === 'string' ? value : '';
	return weekStartDays.includes(raw as WeekStartDay) ? (raw as WeekStartDay) : 'monday';
};

export const weekStartDay = (value?: number | null): WeekStartDay =>
	value === 0 ? 'sunday' : 'monday';

export const weekStartValue = (value: WeekStartDay): number => (value === 'sunday' ? 0 : 1);

export const localeFromForm = (value: FormDataEntryValue | null): string | undefined => {
	if (typeof value !== 'string') return;
	const locale = value.trim();
	if (!locale) return defaultLocale;
	try {
		return new Intl.Locale(locale).toString();
	} catch {
		return;
	}
};

export const timezoneFromForm = (value: FormDataEntryValue | null): string | null | undefined => {
	if (typeof value !== 'string') return;
	const timezone = value.trim();
	if (!timezone) return null;
	if (timezone === defaultTimezone) return timezone;
	if (Intl.supportedValuesOf('timeZone').includes(timezone)) return timezone;
	return;
};

export const numberFromForm = (value: FormDataEntryValue | null, fallback: number): number => {
	if (typeof value !== 'string') return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
};

export const timeFromForm = (value: FormDataEntryValue | null): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
};

export const inviteExpiryFromForm = (value: FormDataEntryValue | null): string => {
	const days = Number.parseInt(String(value ?? '7'), 10);
	const safeDays = inviteExpiryDays.includes(days as (typeof inviteExpiryDays)[number]) ? days : 7;
	return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000).toISOString();
};

export const localeFallbacks = (locale: string): string[] => {
	try {
		const parsed = new Intl.Locale(locale);
		return [...new Set([parsed.toString(), parsed.language, defaultLocale])];
	} catch {
		return [defaultLocale];
	}
};
