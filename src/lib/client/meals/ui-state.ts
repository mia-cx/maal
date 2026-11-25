import type { MaalDatabase } from '$lib/client/local/database.js';
import type { DailyScrollState, ScheduleMode } from '$lib/components/dashboard/schedule-types.js';

export interface ScheduleUiState {
	scheduleMode: ScheduleMode;
	scheduleAnchorDate: string;
	dailyScroll: DailyScrollState | null;
}

const dateKey = (date = new Date(), timeZone?: string): string => {
	if (timeZone) {
		const parts = Object.fromEntries(
			new Intl.DateTimeFormat('en-CA', {
				timeZone,
				year: 'numeric',
				month: '2-digit',
				day: '2-digit'
			})
				.formatToParts(date)
				.map(({ type, value }) => [type, value])
		);
		return `${parts.year}-${parts.month}-${parts.day}`;
	}
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

export const scheduleUiStateKey = (profileId: string, householdId: string): string =>
	`schedule:${profileId}:${householdId}`;

export const defaultScheduleUiState = (timeZone?: string): ScheduleUiState => ({
	scheduleMode: 'multi-day',
	scheduleAnchorDate: dateKey(new Date(), timeZone),
	dailyScroll: null
});

const validDate = (value: unknown): value is string =>
	typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const normalizeScheduleUiState = (value: unknown, timeZone?: string): ScheduleUiState => {
	const fallback = defaultScheduleUiState(timeZone);
	if (!value || typeof value !== 'object') return fallback;
	const candidate = value as Partial<ScheduleUiState>;
	const scheduleMode = ['daily', 'multi-day', 'monthly'].includes(candidate.scheduleMode ?? '')
		? candidate.scheduleMode!
		: fallback.scheduleMode;
	const dailyScroll =
		candidate.dailyScroll &&
		validDate(candidate.dailyScroll.date) &&
		Number.isFinite(candidate.dailyScroll.offset)
			? { date: candidate.dailyScroll.date, offset: Math.max(0, candidate.dailyScroll.offset) }
			: null;
	return {
		scheduleMode,
		scheduleAnchorDate: validDate(candidate.scheduleAnchorDate)
			? candidate.scheduleAnchorDate
			: fallback.scheduleAnchorDate,
		dailyScroll
	};
};

export const readScheduleUiState = async (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	timeZone?: string
): Promise<ScheduleUiState> =>
	normalizeScheduleUiState(
		(await database.uiState.get(scheduleUiStateKey(profileId, householdId)))?.value,
		timeZone
	);

export const writeScheduleUiState = async (
	database: MaalDatabase,
	profileId: string,
	householdId: string,
	value: ScheduleUiState
): Promise<void> => {
	await database.uiState.put({
		key: scheduleUiStateKey(profileId, householdId),
		value: normalizeScheduleUiState(value)
	});
};
