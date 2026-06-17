import type { Meal } from '$lib/plan/plan-types';

export type ScheduleMode = 'daily' | 'multi-day' | 'monthly';

export type {
	HouseholdMember,
	Meal,
	MealCheckIn,
	MealFamiliarity,
	MealStatus
} from '$lib/plan/plan-types';

export type MealCardDensity = 'title' | 'summary' | 'detail';

export type MealPickHandler = (meal: Meal, event: PointerEvent) => void;
export type MealSelectHandler = (meal: Meal) => void;
export type MealCheckInHandler = (meal: Meal) => void;
export type MealAddHandler = (date?: string) => void;

export type MealDropTarget =
	| { kind: 'pool'; index: number }
	| { kind: 'date'; date: string; index: number };

export const scheduleDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const sundayFirstScheduleDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
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
] as const;
