import {
	setDailyScroll,
	uiState,
	updateUiState,
	type DailyScrollState,
	type UiState
} from './ui-state';

export type ScheduleUiState = Pick<UiState, 'scheduleMode' | 'scheduleAnchorDate' | 'dailyScroll'>;

export const scheduleUiState = uiState;

export const clearScheduleDailyScroll = () => {
	updateUiState({ dailyScroll: null });
};

export const updateScheduleUiState = (patch: Partial<ScheduleUiState>) => {
	updateUiState(patch);
};

export const setScheduleDailyScroll = (dailyScroll: DailyScrollState) => {
	setDailyScroll(dailyScroll);
};
