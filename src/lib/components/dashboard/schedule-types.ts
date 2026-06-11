export type ScheduleMode = 'daily' | 'multi-day' | 'monthly';

export type MealFamiliarity = 'safe' | 'exploration' | 'wildcard';

export type MealCardDensity = 'title' | 'summary' | 'detail';

export type MealPickHandler = (meal: Meal, event: PointerEvent) => void;
export type MealSelectHandler = (meal: Meal) => void;
export type MealCheckInHandler = (meal: Meal) => void;
export type MealAddHandler = (date?: string) => void;

export type Meal = {
	id: string;
	userRecipeId?: string;
	title: string;
	day?: string;
	date?: string;
	time?: string;
	sortOrder?: number;
	cookTimeMinutes?: number;
	adjustedCookTimeMinutes?: number;
	servingsPlanned?: number;
	baseServings?: number;
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
export const sundayFirstScheduleDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const scheduleDaysFor = (weekStartsOn: 'sunday' | 'monday') =>
	weekStartsOn === 'sunday' ? sundayFirstScheduleDays : scheduleDays;

export const fullScheduleDays = [
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday'
];
