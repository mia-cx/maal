import { integerFromForm, stringFromForm } from './form-parsing';
import {
	localeFromForm,
	timeFromForm,
	timezoneFromForm,
	weekStartDays,
	weekStartValue,
	type WeekStartDay
} from './settings-parsing';

export type HouseholdProfileUpdate = Partial<{
	defaultPlannedYield: number;
	locale: string;
	timezone: string | null;
	weekStartsOn: number;
	preferredDinnerTime: string | null;
}>;

export type HouseholdProfileParseResult =
	| { ok: true; update: HouseholdProfileUpdate }
	| { ok: false; message: string };

export const profileUpdateFromForm = (form: FormData): HouseholdProfileParseResult => {
	const update: HouseholdProfileUpdate = {};
	if (form.has('defaultServings')) {
		const defaultServings = integerFromForm({
			value: form.get('defaultServings'),
			message: 'Default servings must be a whole number from 1 to 24.',
			min: 1,
			max: 24
		});
		if (!defaultServings.ok) return { ok: false, message: defaultServings.message };
		update.defaultPlannedYield = defaultServings.value;
	}
	if (form.has('locale')) {
		const locale = localeFromForm(form.get('locale'));
		if (!locale) return { ok: false, message: 'Locale is invalid.' };
		update.locale = locale;
	}
	if (form.has('timezone')) {
		const timezone = timezoneFromForm(form.get('timezone'));
		if (timezone === undefined) return { ok: false, message: 'Timezone is invalid.' };
		update.timezone = timezone;
	}
	if (form.has('weekStartsOn')) {
		const parsed = stringFromForm(form.get('weekStartsOn'), 'Week start day is invalid.');
		if (!parsed.ok || !weekStartDays.includes(parsed.value as WeekStartDay)) {
			return { ok: false, message: 'Week start day is invalid.' };
		}
		update.weekStartsOn = weekStartValue(parsed.value as WeekStartDay);
	}
	if (form.has('preferredDinnerTime')) {
		const rawTime = stringFromForm(
			form.get('preferredDinnerTime'),
			'Preferred dinner time is invalid.'
		);
		if (!rawTime.ok) return { ok: false, message: rawTime.message };
		if (!rawTime.value) {
			update.preferredDinnerTime = null;
		} else {
			const preferredDinnerTime = timeFromForm(rawTime.value);
			if (!preferredDinnerTime) return { ok: false, message: 'Preferred dinner time is invalid.' };
			update.preferredDinnerTime = preferredDinnerTime;
		}
	}
	return { ok: true, update };
};
