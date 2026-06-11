import type { RecipeMenuItem } from './menu-types';

export const myMenuRecipes: RecipeMenuItem[] = [
	{
		id: 'recipe-chicken-rice-bowls',
		title: 'Chicken rice bowls',
		description: 'Gingery chicken, rice, crunchy cucumbers, and a quick sesame sauce.',
		image:
			'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80',
		sourceUrl: 'https://maal.local/recipes/chicken-rice-bowls',
		sourceSiteName: 'Maal kitchen',
		sourceAuthorName: 'Mia',
		sourcePublisherName: 'Maal',
		prepTimeMinutes: 10,
		cookTimeMinutes: 25,
		totalTimeMinutes: 35,
		servings: 3,
		ingredientCount: 9,
		ingredients: [
			{ amount: '1 lb', item: 'chicken thighs' },
			{ amount: '1 cup', item: 'rice' },
			{ amount: '1', item: 'cucumber' },
			{ amount: '1 tbsp', item: 'ginger' },
			{ amount: '2 tbsp', item: 'soy sauce' },
			{ amount: '1 tbsp', item: 'sesame oil' }
		],
		instructions: [
			{ position: 1, text: 'Cook rice.' },
			{ position: 2, text: 'Brown chicken with ginger.' },
			{ position: 3, text: 'Slice cucumbers and mix sauce.' },
			{ position: 4, text: 'Assemble bowls.' }
		],
		appliances: ['stovetop', 'rice cooker'],
		dietTags: ['high protein'],
		timesCooked: 14,
		plannedCount: 19,
		lastCookedAt: '2026-05-28',
		latestVerdict: 'worth_repeating',
		reviewSummary: {
			worthRepeating: 8,
			neutral: 1,
			neverAgain: 0,
			notes: ['Reliable weeknight bowl', 'Sauce keeps well for lunch leftovers']
		}
	},
	{
		id: 'recipe-tomato-soup',
		title: 'Tomato soup',
		description: 'Silky tomato soup with toasted bread and a little cream at the end.',
		image:
			'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80',
		sourceUrl: 'https://maal.local/family/tomato-soup',
		sourceSiteName: 'Family notebook',
		sourceAuthorName: 'Family notebook',
		sourcePublisherName: 'Maal',
		prepTimeMinutes: 8,
		cookTimeMinutes: 35,
		totalTimeMinutes: 43,
		servings: 4,
		ingredientCount: 7,
		ingredients: [
			{ amount: '28 oz', item: 'canned tomatoes' },
			{ amount: '1', item: 'onion' },
			{ amount: '2 cloves', item: 'garlic' },
			{ amount: '2 cups', item: 'stock' },
			{ amount: '1/4 cup', item: 'cream' },
			{ amount: '', item: 'bread' }
		],
		instructions: [
			{ position: 1, text: 'Cook onion and garlic.' },
			{ position: 2, text: 'Simmer tomatoes with stock.' },
			{ position: 3, text: 'Blend until smooth and finish with cream.' }
		],
		appliances: ['stovetop', 'blender'],
		dietTags: ['vegetarian'],
		timesCooked: 10,
		plannedCount: 13,
		lastCookedAt: '2026-05-12',
		latestVerdict: 'worth_repeating',
		reviewSummary: {
			worthRepeating: 6,
			neutral: 2,
			neverAgain: 0,
			notes: ['Good low-capacity meal', 'Needs grilled cheese or toast']
		}
	},
	{
		id: 'recipe-pasta-night',
		title: 'Pasta night',
		description: 'Weeknight pasta with a bright tomato sauce, parmesan, and a green salad.',
		image:
			'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=80',
		sourceUrl: 'https://example.com/pasta-night',
		sourceSiteName: 'Imported',
		sourceAuthorName: 'Imported author',
		sourcePublisherName: 'Example Kitchen',
		prepTimeMinutes: 10,
		cookTimeMinutes: 30,
		totalTimeMinutes: 40,
		servings: 4,
		ingredientCount: 8,
		ingredients: [
			{ amount: '12 oz', item: 'pasta' },
			{ amount: '14 oz', item: 'tomatoes' },
			{ amount: '2 cloves', item: 'garlic' },
			{ amount: '1/2 cup', item: 'parmesan' },
			{ amount: '2 tbsp', item: 'olive oil' },
			{ amount: '4 cups', item: 'salad greens' }
		],
		instructions: [
			{ position: 1, text: 'Boil pasta.' },
			{ position: 2, text: 'Make tomato sauce.' },
			{ position: 3, text: 'Toss pasta with sauce and parmesan.' }
		],
		appliances: ['stovetop'],
		dietTags: ['vegetarian option'],
		timesCooked: 22,
		plannedCount: 27,
		lastCookedAt: '2026-06-03',
		latestVerdict: 'worth_repeating',
		reviewSummary: {
			worthRepeating: 11,
			neutral: 3,
			neverAgain: 0,
			notes: ['Default fallback', 'Add greens when energy allows']
		}
	},
	{
		id: 'recipe-salmon-greens',
		title: 'Salmon and greens',
		description: 'Roasted salmon, lemony greens, and potatoes for a steadier dinner.',
		image:
			'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=900&q=80',
		sourceUrl: 'https://maal.local/recipes/salmon-greens',
		sourceSiteName: 'Maal kitchen',
		sourceAuthorName: 'Mia',
		sourcePublisherName: 'Maal',
		prepTimeMinutes: 15,
		cookTimeMinutes: 45,
		totalTimeMinutes: 60,
		servings: 2,
		ingredientCount: 10,
		ingredients: [
			{ amount: '2 fillets', item: 'salmon' },
			{ amount: '1 lb', item: 'potatoes' },
			{ amount: '1 bunch', item: 'greens' },
			{ amount: '1', item: 'lemon' },
			{ amount: '2 tbsp', item: 'olive oil' }
		],
		instructions: [
			{ position: 1, text: 'Roast potatoes.' },
			{ position: 2, text: 'Add salmon to the oven.' },
			{ position: 3, text: 'Wilt greens with lemon.' }
		],
		appliances: ['oven', 'stovetop'],
		dietTags: ['high protein', 'gluten free'],
		timesCooked: 3,
		plannedCount: 6,
		lastCookedAt: '2026-04-20',
		latestVerdict: 'neutral',
		reviewSummary: {
			worthRepeating: 1,
			neutral: 2,
			neverAgain: 0,
			notes: ['Good but timing is easy to miss', 'Buy fish day-of']
		}
	},
	{
		id: 'recipe-tacos',
		title: 'Tacos',
		description: 'Tortillas, spiced filling, quick slaw, and all the small topping bowls.',
		image:
			'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=900&q=80',
		sourceUrl: 'https://example.com/tacos',
		sourceSiteName: 'Imported',
		sourceAuthorName: 'Imported author',
		sourcePublisherName: 'Example Kitchen',
		prepTimeMinutes: 20,
		cookTimeMinutes: 40,
		totalTimeMinutes: 60,
		servings: 4,
		ingredientCount: 13,
		ingredients: [
			{ amount: '8', item: 'tortillas' },
			{ amount: '1 lb', item: 'spiced filling' },
			{ amount: '2 cups', item: 'slaw' },
			{ amount: '1', item: 'lime' },
			{ amount: '1/2 cup', item: 'salsa' },
			{ amount: '1', item: 'avocado' }
		],
		instructions: [
			{ position: 1, text: 'Cook filling.' },
			{ position: 2, text: 'Make slaw and toppings.' },
			{ position: 3, text: 'Warm tortillas and serve.' }
		],
		appliances: ['stovetop'],
		dietTags: ['vegetarian option'],
		timesCooked: 5,
		plannedCount: 9,
		lastCookedAt: '2026-03-19',
		latestVerdict: 'neutral',
		reviewSummary: {
			worthRepeating: 2,
			neutral: 3,
			neverAgain: 1,
			notes: ['Tasty but lots of bowls', 'Better on adventurous days']
		}
	},
	{
		id: 'recipe-lentil-salad',
		title: 'Lentil salad',
		description: 'A no-clock fallback with lentils, herbs, cucumber, olive oil, and lemon.',
		image:
			'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80',
		sourceUrl: 'https://maal.local/family/lentil-salad',
		sourceSiteName: 'Family notebook',
		sourceAuthorName: 'Family notebook',
		sourcePublisherName: 'Maal',
		prepTimeMinutes: 15,
		cookTimeMinutes: 20,
		totalTimeMinutes: 35,
		servings: 3,
		ingredientCount: 8,
		ingredients: [
			{ amount: '1 cup', item: 'lentils' },
			{ amount: '1', item: 'cucumber' },
			{ amount: '1 cup', item: 'herbs' },
			{ amount: '1', item: 'lemon' },
			{ amount: '3 tbsp', item: 'olive oil' },
			{ amount: '', item: 'salt' }
		],
		instructions: [
			{ position: 1, text: 'Cook lentils.' },
			{ position: 2, text: 'Chop cucumber and herbs.' },
			{ position: 3, text: 'Dress with lemon and olive oil.' }
		],
		appliances: ['stovetop'],
		dietTags: ['vegetarian', 'gluten free'],
		timesCooked: 8,
		plannedCount: 11,
		lastCookedAt: '2026-05-31',
		latestVerdict: 'worth_repeating',
		reviewSummary: {
			worthRepeating: 5,
			neutral: 1,
			neverAgain: 0,
			notes: ['Best cold', 'Good backup when plans shift']
		}
	}
];
