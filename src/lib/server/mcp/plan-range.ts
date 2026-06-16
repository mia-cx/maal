import { addUtcDays, dateKey, utcDateFromKey, utcDaysBetween } from '$lib/shared/utc-date';
import { text } from './scalars';
import { toolError } from './results';

const defaultPlanRangeDays = 14;
const maxPlanRangeDays = 62;
const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

const parseDateKey = (value: string, name: string): string => {
	if (!dateKeyPattern.test(value) || dateKey(utcDateFromKey(value)) !== value) {
		throw toolError('invalid_input', `${name} must be a valid YYYY-MM-DD date.`);
	}
	return value;
};

export const defaultPlanRange = (args: Record<string, unknown>) => {
	const startDate = text(args.startDate);
	const endDate = text(args.endDate);
	let range = startDate
		? {
				startDate: parseDateKey(startDate, 'startDate'),
				endDate: endDate
					? parseDateKey(endDate, 'endDate')
					: dateKey(addUtcDays(utcDateFromKey(startDate), defaultPlanRangeDays))
			}
		: endDate
			? (() => {
					const validEndDate = parseDateKey(endDate, 'endDate');
					return {
						startDate: dateKey(addUtcDays(utcDateFromKey(validEndDate), -defaultPlanRangeDays)),
						endDate: validEndDate
					};
				})()
			: (() => {
					const today = new Date();
					return {
						startDate: dateKey(today),
						endDate: dateKey(addUtcDays(today, defaultPlanRangeDays))
					};
				})();
	if (utcDaysBetween(range.startDate, range.endDate) < 0) {
		throw toolError('invalid_input', 'endDate must be on or after startDate.');
	}
	if (utcDaysBetween(range.startDate, range.endDate) > maxPlanRangeDays) {
		range = {
			startDate: range.startDate,
			endDate: dateKey(addUtcDays(utcDateFromKey(range.startDate), maxPlanRangeDays))
		};
	}
	return range;
};
