import { describe, expect, it } from 'vitest';
import { profileUpdateFromForm } from './profile-settings';

describe('profileUpdateFromForm', () => {
	it('parses household profile fields', () => {
		const form = new FormData();
		form.set('defaultServings', '32');
		form.set('locale', 'en-GB');
		form.set('timezone', 'Europe/London');
		form.set('weekStartsOn', 'sunday');
		form.set('preferredDinnerTime', '18:30');

		expect(profileUpdateFromForm(form)).toEqual({
			ok: true,
			update: {
				defaultPlannedYield: 24,
				locale: 'en-GB',
				timezone: 'Europe/London',
				weekStartsOn: 0,
				preferredDinnerTime: '18:30'
			}
		});
	});

	it('rejects invalid locale and timezone', () => {
		const invalidLocale = new FormData();
		invalidLocale.set('locale', 'not a locale');
		expect(profileUpdateFromForm(invalidLocale)).toEqual({
			ok: false,
			message: 'Locale is invalid.'
		});

		const invalidTimezone = new FormData();
		invalidTimezone.set('timezone', 'Nope/Nope');
		expect(profileUpdateFromForm(invalidTimezone)).toEqual({
			ok: false,
			message: 'Timezone is invalid.'
		});
	});
});
