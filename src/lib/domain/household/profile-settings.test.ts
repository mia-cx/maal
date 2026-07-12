import { describe, expect, it } from 'vitest';
import { profileUpdateFromForm } from './profile-settings';

describe('profileUpdateFromForm', () => {
	it('parses household profile fields', () => {
		const form = new FormData();
		form.set('defaultServings', '24');
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

	it('rejects malformed profile fields instead of falling back', () => {
		const invalidServings = new FormData();
		invalidServings.set('defaultServings', '12abc');
		expect(profileUpdateFromForm(invalidServings)).toEqual({
			ok: false,
			message: 'Default servings must be a whole number from 1 to 24.'
		});

		const invalidWeekStart = new FormData();
		invalidWeekStart.set('weekStartsOn', 'tuesday');
		expect(profileUpdateFromForm(invalidWeekStart)).toEqual({
			ok: false,
			message: 'Week start day is invalid.'
		});

		const invalidDinnerTime = new FormData();
		invalidDinnerTime.set('preferredDinnerTime', '6pm');
		expect(profileUpdateFromForm(invalidDinnerTime)).toEqual({
			ok: false,
			message: 'Preferred dinner time is invalid.'
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

	it('allows clearing preferred dinner time', () => {
		const form = new FormData();
		form.set('preferredDinnerTime', '');

		expect(profileUpdateFromForm(form)).toEqual({
			ok: true,
			update: { preferredDinnerTime: null }
		});
	});
});
