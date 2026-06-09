export type ScheduleMode = 'daily' | 'weekly' | 'monthly';

export type Meal = {
	id: string;
	title: string;
	day: string;
	time?: string;
	status: 'floating' | 'planned';
};

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
