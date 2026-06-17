import type { Meal } from '$lib/plan/plan-types';

type MealResponse = { meal: Meal };
type MealRangeResponse = { meals: Meal[] };

export class ScheduleMealClientError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body: string,
		readonly context: string
	) {
		super(message);
		this.name = 'ScheduleMealClientError';
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isMeal = (value: unknown): value is Meal =>
	isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string';

const isMealRangeResponse = (value: unknown): value is MealRangeResponse =>
	isRecord(value) && Array.isArray(value.meals) && value.meals.every(isMeal);

const isMealResponse = (value: unknown): value is MealResponse =>
	isRecord(value) && isMeal(value.meal);

const responseText = async (response: Response): Promise<string> => {
	try {
		return await response.text();
	} catch {
		return '';
	}
};

const requestJson = async (input: RequestInfo | URL, init: RequestInit, context: string) => {
	const response = await fetch(input, init);
	if (!response.ok) {
		const body = await responseText(response);
		throw new ScheduleMealClientError(
			body || `${context} failed with ${response.status}.`,
			response.status,
			body,
			context
		);
	}
	try {
		return await response.json();
	} catch (cause) {
		throw new ScheduleMealClientError(
			cause instanceof Error ? cause.message : `${context} returned invalid JSON.`,
			response.status,
			'',
			context
		);
	}
};

export const fetchScheduleMealRange = async (range: {
	start: string;
	end: string;
}): Promise<Meal[]> => {
	const params = new URLSearchParams({ start: range.start, end: range.end });
	const body = await requestJson(`/plan/meals?${params}`, {}, 'Load meal range');
	if (!isMealRangeResponse(body)) {
		throw new ScheduleMealClientError(
			'Meal range response was invalid.',
			200,
			'',
			'Load meal range'
		);
	}
	return body.meals;
};

export const deleteScheduleMealRemote = async (mealId: string): Promise<void> => {
	await requestJson(
		'/plan/meals',
		{
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ mealId })
		},
		'Delete meal'
	);
};

export const updateScheduleMealRemote = async (meal: Meal): Promise<void> => {
	await requestJson(
		'/plan/meals',
		{
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ meal })
		},
		'Update meal'
	);
};

export const createScheduleMealRemote = async (meal: Meal): Promise<Meal> => {
	const body = await requestJson(
		'/plan/meals',
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ meal })
		},
		'Create meal'
	);
	if (!isMealResponse(body)) {
		throw new ScheduleMealClientError('Meal response was invalid.', 200, '', 'Create meal');
	}
	return body.meal;
};
