import { addDays, dateFromKey, dateKey } from './schedule-date';

export type MealRange = { start: string; end: string };

const nextDateKey = (key: string): string => dateKey(addDays(dateFromKey(key), 1));
const previousDateKey = (key: string): string => dateKey(addDays(dateFromKey(key), -1));

export const hasLoadedMealRange = (
	loadedMealRanges: MealRange[],
	start: string,
	end: string
): boolean => loadedMealRanges.some((range) => range.start <= start && range.end >= end);

export const missingMealRanges = (loadedMealRanges: MealRange[], range: MealRange): MealRange[] => {
	let cursor = range.start;
	const missing: MealRange[] = [];
	const overlappingRanges = loadedMealRanges
		.filter((loadedRange) => loadedRange.end >= range.start && loadedRange.start <= range.end)
		.toSorted((left, right) => left.start.localeCompare(right.start));

	for (const loadedRange of overlappingRanges) {
		if (loadedRange.start > cursor) {
			missing.push({ start: cursor, end: previousDateKey(loadedRange.start) });
		}
		if (loadedRange.end >= cursor) cursor = nextDateKey(loadedRange.end);
		if (cursor > range.end) break;
	}
	if (cursor <= range.end) missing.push({ start: cursor, end: range.end });
	return missing;
};

export const parseMealRangeError = async (response: Response): Promise<string> => {
	const body = await response.text();
	try {
		const parsed = JSON.parse(body) as { message?: string };
		return parsed.message ?? body;
	} catch {
		return body;
	}
};
