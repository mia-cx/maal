import { describe, expect, it } from 'vitest';
import { isSettingsCategory, settingsRedirectPath } from './routes';

describe('settings route helpers', () => {
	it('accepts every settings category used by the settings UI', () => {
		expect(isSettingsCategory('account')).toBe(true);
		expect(isSettingsCategory('security')).toBe(true);
		expect(isSettingsCategory('mcp')).toBe(true);
		expect(isSettingsCategory('notifications')).toBe(true);
		expect(isSettingsCategory('billing')).toBe(true);
		expect(isSettingsCategory('unknown')).toBe(false);
	});

	it('builds encoded plan redirects', () => {
		expect(settingsRedirectPath()).toBe('/plan?settings=account');
		expect(settingsRedirectPath('mcp')).toBe('/plan?settings=mcp');
	});
});
