import type { Meal } from './schedule-types';

export const scheduleMeals: Meal[] = [
	{ id: 'floating-1', title: 'Chicken rice bowls', day: 'Floating', status: 'floating' },
	{ id: 'floating-2', title: 'Tomato soup', day: 'Floating', status: 'floating' },
	{ id: 'planned-1', title: 'Pasta night', day: 'Monday', time: '18:30', status: 'planned' },
	{
		id: 'planned-2',
		title: 'Salmon and greens',
		day: 'Wednesday',
		time: '19:00',
		status: 'planned'
	},
	{ id: 'planned-3', title: 'Tacos', day: 'Friday', time: '18:00', status: 'planned' }
];
