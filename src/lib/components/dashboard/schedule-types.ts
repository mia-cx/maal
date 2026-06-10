export type ScheduleMode = 'daily' | 'multi-day' | 'monthly';

export type MealFamiliarity = 'new' | 'exploration' | 'safe' | 'survival' | 'wildcard';

export type MealCardDensity = 'title' | 'summary' | 'detail';

export type MealPickHandler = (meal: Meal, event: PointerEvent) => void;
export type MealSelectHandler = (meal: Meal) => void;

export type Meal = {
	id: string;
	title: string;
	day?: string;
	date?: string;
	time?: string;
	sortOrder?: number;
	cookTimeMinutes?: number;
	adjustedCookTimeMinutes?: number;
	familiarity?: MealFamiliarity;
	image?: string;
	description?: string;
	ingredients?: string[];
	instructions?: string[];
};

export type MealDropTarget =
	| { kind: 'pool'; index: number }
	| { kind: 'date'; date: string; index: number };

export const scheduleDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const fullScheduleDays = [
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday'
];
