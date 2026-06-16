import { uiState, updateUiState, type UiState } from './ui-state';

export type AppShellUiState = Pick<UiState, 'activeNav' | 'sidebarOpen' | 'sidebarWidth'>;

export const appShellUiState = uiState;

export const updateAppShellUiState = (patch: Partial<AppShellUiState>) => {
	updateUiState(patch);
};
