const dayMs = 86_400_000;

export const dateKey = (date: Date): string => date.toISOString().slice(0, 10);

export const utcDateFromKey = (key: string): Date => new Date(`${key}T00:00:00Z`);

export const addUtcDays = (date: Date, days: number): Date => {
	const nextDate = new Date(date);
	nextDate.setUTCDate(nextDate.getUTCDate() + days);
	return nextDate;
};

export const utcDaysBetween = (startDate: string, endDate: string): number =>
	Math.floor((utcDateFromKey(endDate).getTime() - utcDateFromKey(startDate).getTime()) / dayMs);
