import type { Meal } from './schedule-types';

export const scheduleMeals: Meal[] = [
	{
		id: 'pool-1',
		title: 'Chicken rice bowls',
		sortOrder: 1000,
		cookTimeMinutes: 25,
		familiarity: 'safe',
		image:
			'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80',
		description: 'Gingery chicken, rice, crunchy cucumbers, and a quick sesame sauce.',
		ingredients: [
			'Boneless chicken thighs',
			'Cooked rice',
			'Cucumber and scallions',
			'Ginger, soy sauce, sesame oil',
			'Lime or rice vinegar'
		],
		instructions: [
			'Sear the chicken until browned and cooked through.',
			'Stir together ginger, soy, sesame oil, and lime for the sauce.',
			'Slice the chicken and build bowls with rice, cucumber, scallions, and sauce.'
		]
	},
	{
		id: 'pool-2',
		title: 'Tomato soup',
		sortOrder: 2000,
		cookTimeMinutes: 35,
		familiarity: 'safe',
		image:
			'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80',
		description: 'Silky tomato soup with toasted bread and a little cream at the end.',
		ingredients: [
			'Canned tomatoes',
			'Onion and garlic',
			'Vegetable broth',
			'Cream',
			'Bread for toast'
		],
		instructions: [
			'Soften onion and garlic in a little oil.',
			'Add tomatoes and broth, then simmer until everything tastes rounded.',
			'Blend smooth, finish with cream, and serve with toast.'
		]
	},
	{
		id: 'planned-1',
		title: 'Pasta night',
		day: 'Tuesday',
		date: '2026-06-09',
		time: '18:30',
		cookTimeMinutes: 30,
		familiarity: 'safe',
		image:
			'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=80',
		description: 'Weeknight pasta with a bright tomato sauce, parmesan, and a green salad.',
		ingredients: ['Pasta', 'Tomato sauce', 'Parmesan', 'Mixed greens', 'Olive oil and vinegar'],
		instructions: [
			'Boil pasta in salted water until just tender.',
			'Warm the sauce and loosen it with a splash of pasta water.',
			'Toss pasta with sauce, top with parmesan, and serve with a quick salad.'
		]
	},
	{
		id: 'planned-2',
		title: 'Salmon and greens',
		day: 'Tuesday',
		date: '2026-06-09',
		time: '19:00',
		cookTimeMinutes: 45,
		familiarity: 'exploration',
		image:
			'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=900&q=80',
		description: 'Roasted salmon, lemony greens, and potatoes for a steadier dinner.',
		ingredients: ['Salmon fillets', 'Potatoes', 'Greens', 'Lemon', 'Butter or olive oil'],
		instructions: [
			'Roast potatoes until crisp at the edges.',
			'Add salmon to the sheet pan and roast until just cooked.',
			'Sauté greens with lemon and serve everything together.'
		]
	},
	{
		id: 'planned-3',
		title: 'Tacos',
		day: 'Tuesday',
		date: '2026-06-09',
		time: '18:00',
		cookTimeMinutes: 40,
		familiarity: 'wildcard',
		image:
			'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=900&q=80',
		description: 'Tortillas, spiced filling, quick slaw, and all the small topping bowls.',
		ingredients: [
			'Tortillas',
			'Spiced beans or meat',
			'Cabbage slaw',
			'Salsa',
			'Cheese or avocado'
		],
		instructions: [
			'Cook the filling with spices until hot and saucy.',
			'Toss cabbage with lime and salt for a quick slaw.',
			'Warm tortillas and set out toppings for assembly.'
		]
	},
	{
		id: 'planned-4',
		title: 'Lentil salad',
		day: 'Tuesday',
		date: '2026-06-09',
		sortOrder: 1000,
		cookTimeMinutes: 20,
		familiarity: 'safe',
		image:
			'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80',
		description: 'A no-clock fallback with lentils, herbs, and lemon.',
		ingredients: ['Cooked lentils', 'Parsley or dill', 'Lemon', 'Olive oil', 'Cucumber or celery'],
		instructions: [
			'Rinse lentils and chop the herbs and crunchy vegetables.',
			'Whisk lemon, olive oil, salt, and pepper.',
			'Toss everything together and adjust until bright.'
		]
	}
];
