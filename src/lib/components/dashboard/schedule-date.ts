const dayMs = 24 * 60 * 60 * 1000;

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

export const startOfWeek = (date: Date): Date => {
	const start = startOfDay(date);
	const day = start.getDay();
	const offset = day === 0 ? -6 : 1 - day;
	return addDays(start, offset);
};

export const startOfMonthGrid = (date: Date): Date =>
	startOfWeek(new Date(date.getFullYear(), date.getMonth(), 1));

export const monthGridDays = (date: Date): Date[] => {
	const start = startOfMonthGrid(date);
	return Array.from({ length: 42 }, (_, index) => addDays(start, index));
};

export const dailyScrollDays = (date: Date): Date[] => {
	const start = addDays(startOfDay(date), -21);
	return Array.from({ length: 63 }, (_, index) => addDays(start, index));
};

export const formatDayHeading = (date: Date): string =>
	new Intl.DateTimeFormat('en', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric'
	}).format(date);

export const formatMonthHeading = (date: Date): string =>
	new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date);

export const isoWeekNumber = (date: Date): number => {
	const target = startOfDay(date);
	const dayNumber = (target.getDay() + 6) % 7;
	target.setDate(target.getDate() - dayNumber + 3);
	const firstThursday = new Date(target.getFullYear(), 0, 4);
	const firstDayNumber = (firstThursday.getDay() + 6) % 7;
	firstThursday.setDate(firstThursday.getDate() - firstDayNumber + 3);
	return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * dayMs));
};

export const isSameMonth = (left: Date, right: Date): boolean =>
	left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();

export const isToday = (date: Date): boolean =>
	startOfDay(date).getTime() === startOfDay(new Date()).getTime();
