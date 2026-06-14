import { addUtcDays, dateKey, utcDateFromKey, utcDaysBetween } from '$lib/shared/utc-date';
import { text } from './scalars';

const defaultPlanRangeDays = 14;
const maxPlanRangeDays = 62;

export const defaultPlanRange = (args: Record<string, unknown>) => {
	const startDate = text(args.startDate);
	const endDate = text(args.endDate);
	let range = startDate
		? {
				startDate,
				endDate: endDate ?? dateKey(addUtcDays(utcDateFromKey(startDate), defaultPlanRangeDays))
			}
		: endDate
			? {
					startDate: dateKey(addUtcDays(utcDateFromKey(endDate), -defaultPlanRangeDays)),
					endDate
				}
			: (() => {
					const today = new Date();
					return {
						startDate: dateKey(today),
						endDate: dateKey(addUtcDays(today, defaultPlanRangeDays))
					};
				})();
	if (utcDaysBetween(range.startDate, range.endDate) > maxPlanRangeDays) {
		range = {
			startDate: range.startDate,
			endDate: dateKey(addUtcDays(utcDateFromKey(range.startDate), maxPlanRangeDays))
		};
	}
	return range;
};
