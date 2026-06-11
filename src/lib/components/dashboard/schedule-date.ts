const dayMs = 24 * 60 * 60 * 1000;

export type WeekStartsOn = 'sunday' | 'monday';

export const addDays = (date: Date, days: number): Date => {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
};

export const addMonths = (date: Date, months: number): Date => {
	const next = new Date(date);
	next.setMonth(next.getMonth() + months);
	return next;
};

export const startOfDay = (date: Date): Date =>
	new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const startOfWeek = (date: Date, weekStartsOn: WeekStartsOn = 'monday'): Date => {
	const start = startOfDay(date);
	const day = start.getDay();
	const offset = weekStartsOn === 'sunday' ? -day : day === 0 ? -6 : 1 - day;
	return addDays(start, offset);
};

export const startOfMonthGrid = (date: Date, weekStartsOn: WeekStartsOn = 'monday'): Date =>
	startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1), weekStartsOn);

export const monthGridDays = (date: Date, weekStartsOn: WeekStartsOn = 'monday'): Date[] => {
	const start = startOfMonthGrid(date, weekStartsOn);
	return Array.from({ length: 42 }, (_, index) => addDays(start, index));
};

export const dailyScrollDays = (date: Date): Date[] => {
	const start = addDays(startOfDay(date), -21);
	return Array.from({ length: 63 }, (_, index) => addDays(start, index));
};

export const dateKey = (date: Date): string => {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

export const dateFromKey = (key: string): Date => {
	const [year, month, day] = key.split('-').map(Number);
	return new Date(year, month - 1, day);
};

const dayHeadingFormatter = new Intl.DateTimeFormat('en', {
	weekday: 'long',
	month: 'long',
	day: 'numeric',
	year: 'numeric'
});

const monthHeadingFormatter = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });

const relativePrefix = (
	index: number,
	labels: { previous: string; current: string; next: string }
): string | undefined => {
	if (index === -1) return labels.previous;
	if (index === 0) return labels.current;
	if (index === 1) return labels.next;
};

export const formatDayHeading = (date: Date, reference = new Date()): string => {
	const dayOffset = Math.round(
		(startOfDay(date).getTime() - startOfDay(reference).getTime()) / dayMs
	);
	const prefix = relativePrefix(dayOffset, {
		previous: 'Yesterday',
		current: 'Today',
		next: 'Tomorrow'
	});
	const formatted = dayHeadingFormatter.format(date);
	return prefix ? `${prefix}, ${formatted}` : formatted;
};

export const formatWeekHeading = (
	date: Date,
	reference = new Date(),
	weekStartsOn: WeekStartsOn = 'monday'
): string => {
	const weekStart = startOfWeek(date, weekStartsOn);
	const relativeWeekIndex = Math.round(
		(weekStart.getTime() - startOfWeek(reference, weekStartsOn).getTime()) / (7 * dayMs)
	);
	const prefix = relativePrefix(relativeWeekIndex, {
		previous: 'Last Week',
		current: 'This Week',
		next: 'Next Week'
	});
	const formatted = `Week ${isoWeekNumber(date)}, ${isoWeekYear(date)}`;
	return prefix ? `${prefix}, ${formatted}` : formatted;
};

export const formatMonthHeading = (date: Date, reference = new Date()): string => {
	const relativeMonthIndex =
		(date.getFullYear() - reference.getFullYear()) * 12 + date.getMonth() - reference.getMonth();
	const prefix = relativePrefix(relativeMonthIndex, {
		previous: 'Last Month',
		current: 'This Month',
		next: 'Next Month'
	});
	const formatted = monthHeadingFormatter.format(date);
	return prefix ? `${prefix}, ${formatted}` : formatted;
};

const isoWeekThursday = (date: Date): Date => {
	const target = startOfDay(date);
	const dayNumber = (target.getDay() + 6) % 7;
	target.setDate(target.getDate() - dayNumber + 3);
	return target;
};

export const isoWeekYear = (date: Date): number => isoWeekThursday(date).getFullYear();

export const isoWeekNumber = (date: Date): number => {
	const target = isoWeekThursday(date);
	const firstThursday = new Date(target.getFullYear(), 0, 4);
	const firstDayNumber = (firstThursday.getDay() + 6) % 7;
	firstThursday.setDate(firstThursday.getDate() - firstDayNumber + 3);
	return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * dayMs));
};

export const isSameMonth = (left: Date, right: Date): boolean =>
	left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();

export const isToday = (date: Date): boolean =>
	startOfDay(date).getTime() === startOfDay(new Date()).getTime();
