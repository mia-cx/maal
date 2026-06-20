import { readUiStateFromDexie, writeUiStateToDexie } from '$lib/client-db/repositories';
import type { DashboardNavItem } from '$lib/components/dashboard/dashboard-nav';
import type { ScheduleMode } from '$lib/components/dashboard/schedule-types';
import { persistentAtom } from '@nanostores/persistent';

const storageKey = 'maal:ui-state:v1';
const uiStatePersistDelayMs = 500;
const scrollPersistMinOffsetDelta = 24;
const defaultSidebarWidth = 256;
const minSidebarWidth = 208;
const maxSidebarWidth = 384;

export type DailyScrollState = {
	date: string;
	offset: number;
};

export type UiState = {
	activeNav: DashboardNavItem;
	sidebarOpen: boolean;
	sidebarWidth: number;
	scheduleMode: ScheduleMode;
	scheduleAnchorDate: string;
	dailyScroll: DailyScrollState | null;
};

export type UiStateStoreSnapshot = UiState;

const todayKey = (): string => {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, '0');
	const day = String(today.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

const defaultUiState = (): UiState => ({
	activeNav: 'meal-plan',
	sidebarOpen: true,
	sidebarWidth: defaultSidebarWidth,
	scheduleMode: 'multi-day',
	scheduleAnchorDate: todayKey(),
	dailyScroll: null
});

const dashboardNavItems: DashboardNavItem[] = ['meal-plan', 'my-menu'];
const scheduleModes: ScheduleMode[] = ['daily', 'multi-day', 'monthly'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const dashboardNavItemFromStoredValue = (
	value: unknown,
	fallback: DashboardNavItem
): DashboardNavItem => {
	if (value === 'schedule') return 'meal-plan';
	return typeof value === 'string' && dashboardNavItems.includes(value as DashboardNavItem)
		? (value as DashboardNavItem)
		: fallback;
};

const scheduleModeFromStoredValue = (value: unknown, fallback: ScheduleMode): ScheduleMode => {
	if (value === 'weekly') return 'multi-day';
	return typeof value === 'string' && scheduleModes.includes(value as ScheduleMode)
		? (value as ScheduleMode)
		: fallback;
};

const isDateKey = (value: unknown): value is string =>
	typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const clampSidebarWidth = (value: unknown): number => {
	const width = typeof value === 'number' && Number.isFinite(value) ? value : defaultSidebarWidth;
	return Math.min(maxSidebarWidth, Math.max(minSidebarWidth, width));
};

const normalizeUiState = (value: unknown): UiState => {
	const fallback = defaultUiState();
	if (!isRecord(value)) return fallback;

	const dailyScroll = isRecord(value.dailyScroll)
		? {
				date: isDateKey(value.dailyScroll.date)
					? value.dailyScroll.date
					: fallback.scheduleAnchorDate,
				offset:
					typeof value.dailyScroll.offset === 'number' && Number.isFinite(value.dailyScroll.offset)
						? Math.max(0, value.dailyScroll.offset)
						: 0
			}
		: null;

	return {
		activeNav: dashboardNavItemFromStoredValue(value.activeNav, fallback.activeNav),
		sidebarOpen: typeof value.sidebarOpen === 'boolean' ? value.sidebarOpen : fallback.sidebarOpen,
		sidebarWidth: clampSidebarWidth(value.sidebarWidth),
		scheduleMode: scheduleModeFromStoredValue(value.scheduleMode, fallback.scheduleMode),
		scheduleAnchorDate: isDateKey(value.scheduleAnchorDate)
			? value.scheduleAnchorDate
			: fallback.scheduleAnchorDate,
		dailyScroll
	};
};

const dailyScrollsMatch = (
	left: DailyScrollState | null,
	right: DailyScrollState | null
): boolean => {
	if (!left || !right) return left === right;
	return (
		left.date === right.date && Math.abs(left.offset - right.offset) < scrollPersistMinOffsetDelta
	);
};

const uiStatesMatch = (left: UiState, right: UiState): boolean =>
	left.activeNav === right.activeNav &&
	left.sidebarOpen === right.sidebarOpen &&
	left.sidebarWidth === right.sidebarWidth &&
	left.scheduleMode === right.scheduleMode &&
	left.scheduleAnchorDate === right.scheduleAnchorDate &&
	dailyScrollsMatch(left.dailyScroll, right.dailyScroll);

let pendingPersistState: UiState | null = null;
let persistUiStateTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleUiStatePersist = (state: UiState) => {
	pendingPersistState = state;
	if (persistUiStateTimer) clearTimeout(persistUiStateTimer);
	persistUiStateTimer = setTimeout(() => {
		const stateToPersist = pendingPersistState;
		pendingPersistState = null;
		persistUiStateTimer = null;
		if (stateToPersist) void writeUiStateToDexie('app', stateToPersist);
	}, uiStatePersistDelayMs);
};

export const uiState = persistentAtom<UiState>(storageKey, defaultUiState(), {
	decode: (encoded) => {
		try {
			return normalizeUiState(JSON.parse(encoded));
		} catch {
			return defaultUiState();
		}
	},
	encode: (state) => JSON.stringify(normalizeUiState(state))
});

export const hydrateUiStateFromDexie = async () => {
	const cached = await readUiStateFromDexie('app');
	if (!cached) return uiState.get();
	const nextState = normalizeUiState({ ...uiState.get(), ...cached });
	uiState.set(nextState);
	return nextState;
};

export const updateUiState = (patch: Partial<UiState>) => {
	const currentState = uiState.get();
	const nextState = normalizeUiState({ ...currentState, ...patch });
	if (uiStatesMatch(currentState, nextState)) return;
	uiState.set(nextState);
	scheduleUiStatePersist(nextState);
};

export const setDailyScroll = (dailyScroll: DailyScrollState) => {
	updateUiState({ dailyScroll, scheduleAnchorDate: dailyScroll.date });
};
