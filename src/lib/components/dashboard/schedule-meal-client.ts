import type { Meal } from '$lib/plan/plan-types';

export const fetchScheduleMealRange = async (range: {
	start: string;
	end: string;
}): Promise<Meal[]> => {
	const response = await fetch(`/plan/meals?start=${range.start}&end=${range.end}`);
	if (!response.ok) throw response;
	const body = (await response.json()) as { meals: Meal[] };
	return body.meals;
};

export const deleteScheduleMealRemote = async (mealId: string): Promise<void> => {
	const response = await fetch('/plan/meals', {
		method: 'DELETE',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ mealId })
	});
	if (!response.ok) throw new Error(await response.text());
};

export const updateScheduleMealRemote = async (meal: Meal): Promise<void> => {
	const response = await fetch('/plan/meals', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ meal })
	});
	if (!response.ok) throw new Error(await response.text());
};

export const createScheduleMealRemote = async (meal: Meal): Promise<Meal> => {
	const response = await fetch('/plan/meals', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ meal })
	});
	if (!response.ok) throw new Error(await response.text());
	const body = (await response.json()) as { meal: Meal };
	return body.meal;
};
