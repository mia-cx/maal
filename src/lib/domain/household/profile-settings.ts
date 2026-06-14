import {
	asWeekStartDay,
	localeFromForm,
	numberFromForm,
	timeFromForm,
	timezoneFromForm,
	weekStartValue
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
		update.defaultPlannedYield = Math.min(
			24,
			Math.max(1, numberFromForm(form.get('defaultServings'), 1))
		);
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
		update.weekStartsOn = weekStartValue(asWeekStartDay(form.get('weekStartsOn')));
	}
	if (form.has('preferredDinnerTime')) {
		update.preferredDinnerTime = timeFromForm(form.get('preferredDinnerTime'));
	}
	return { ok: true, update };
};
