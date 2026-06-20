import { browser } from '$app/environment';
import {
	createScheduleMealRemote,
	deleteScheduleMealRemote,
	ScheduleMealClientError,
	updateScheduleMealRemote
} from '$lib/components/dashboard/schedule-meal-client';
import type { Meal } from '$lib/components/dashboard/schedule-types';
import {
	archiveMenuRecipesRemote,
	createMenuRecipeRemote,
	permanentlyDeleteMenuRecipesRemote,
	restoreMenuRecipesRemote,
	updateMenuRecipeRemote
} from '$lib/menu/menu-client';
import type { RecipeMenuItem } from '$lib/menu/menu-types';
import { getClientDb } from './db';
import { logClientDbDebug } from './debug';
import { deleteMealFromDexie, writeMealsToDexie, writeRecipesToDexie } from './repositories';
import type { SyncOutboxEntry } from './schema';

const flushDebounceMs = 1_500;
const retryIntervalMs = 30_000;
const maxBackoffMs = 5 * 60_000;
const maxMissingMealUpdateAttempts = 3;

let started = false;
let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setInterval> | null = null;

type MealPayload = { meal?: Meal; mealId?: string };
type RecipePayload = {
	recipe?: RecipeMenuItem;
	recipeIds?: string[];
	permanent?: boolean;
	title?: string;
	url?: string;
};

const backoffMs = (attempts: number) =>
	Math.min(maxBackoffMs, retryIntervalMs * 2 ** Math.max(0, attempts - 1));

const localMealIdPrefix = 'local-meal-';
const localRecipeIdPrefixes = ['draft-recipe-', 'local-recipe-'];
const isLocalMealId = (mealId: string): boolean => mealId.startsWith(localMealIdPrefix);
const isLocalRecipeId = (recipeId: string): boolean =>
	localRecipeIdPrefixes.some((prefix) => recipeId.startsWith(prefix));

const isNotFoundError = (error: unknown): boolean =>
	error instanceof ScheduleMealClientError
		? error.status === 404
		: error instanceof Error && /not found/i.test(error.message);

const outboxPriority = (entry: SyncOutboxEntry): number => {
	if (entry.entityType === 'recipe' && entry.operation === 'create') return 0;
	if (entry.entityType === 'plannedMeal' && entry.operation === 'create') return 1;
	if (entry.entityType === 'plannedMeal' && entry.operation === 'update') return 2;
	if (entry.operation === 'delete') return 4;
	return 3;
};

const payloadRecord = (entry: SyncOutboxEntry): Record<string, unknown> =>
	entry.payload && typeof entry.payload === 'object'
		? (entry.payload as Record<string, unknown>)
		: {};

const isMealPayload = (payload: Record<string, unknown>): payload is Meal =>
	typeof payload.id === 'string' && typeof payload.title === 'string';

const mealPayloadFromEntry = (entry: SyncOutboxEntry): MealPayload => {
	const payload = payloadRecord(entry);
	return isMealPayload(payload) ? { meal: payload } : (payload as MealPayload);
};

const rewritePendingMealRecipeIds = async (localRecipeId: string, remoteRecipeId: string) => {
	if (localRecipeId === remoteRecipeId) return;
	const db = getClientDb();
	if (!db) return;
	const entries = await db.syncOutbox.where('entityType').equals('plannedMeal').toArray();
	await Promise.all(
		entries.map(async (entry) => {
			if (!entry.id) return;
			const payload = mealPayloadFromEntry(entry);
			if (payload.meal?.userRecipeId !== localRecipeId) return;
			await db.syncOutbox.update(entry.id, {
				payload: { ...payload, meal: { ...payload.meal, userRecipeId: remoteRecipeId } },
				nextAttemptAt: Date.now()
			});
		})
	);
};

const createMealTrustingDexie = async (meal: Meal): Promise<Meal> => {
	const mealToCreate =
		meal.userRecipeId && isLocalRecipeId(meal.userRecipeId)
			? { ...meal, userRecipeId: undefined }
			: meal;
	try {
		return await createScheduleMealRemote(mealToCreate);
	} catch (error) {
		if (
			error instanceof ScheduleMealClientError &&
			error.status === 404 &&
			meal.userRecipeId &&
			error.body.includes('Recipe not found')
		) {
			return await createScheduleMealRemote({ ...meal, userRecipeId: undefined });
		}
		throw error;
	}
};

const rewritePendingMealIds = async (localMealId: string, remoteMeal: Meal) => {
	if (localMealId === remoteMeal.id) return;
	const db = getClientDb();
	if (!db) return;
	const entries = await db.syncOutbox.where('entityType').equals('plannedMeal').toArray();
	await Promise.all(
		entries.map(async (entry) => {
			if (!entry.id || entry.entityId !== localMealId) return;
			const payload = mealPayloadFromEntry(entry);
			await db.syncOutbox.update(entry.id, {
				entityId: remoteMeal.id,
				payload: {
					...payload,
					mealId: payload.mealId === localMealId ? remoteMeal.id : payload.mealId,
					meal: payload.meal ? { ...payload.meal, id: remoteMeal.id } : payload.meal
				},
				nextAttemptAt: Date.now()
			});
		})
	);
};

const syncMealEntry = async (entry: SyncOutboxEntry) => {
	const payload = mealPayloadFromEntry(entry);
	if (entry.operation === 'delete') {
		try {
			await deleteScheduleMealRemote(payload.mealId ?? entry.entityId);
		} catch (error) {
			if (error instanceof ScheduleMealClientError && error.status === 404) return;
			throw error;
		}
		return;
	}
	if (!payload.meal) throw new Error(`Missing meal payload for ${entry.operation} outbox entry.`);
	if (entry.operation === 'create') {
		const meal = await createMealTrustingDexie(payload.meal);
		await writeMealsToDexie([meal], entry);
		await rewritePendingMealIds(entry.entityId, meal);
		return;
	}
	if (entry.operation === 'update') {
		try {
			await updateScheduleMealRemote(payload.meal);
		} catch (error) {
			if (
				error instanceof ScheduleMealClientError &&
				error.status === 404 &&
				isLocalMealId(payload.meal.id)
			) {
				const meal = await createMealTrustingDexie(payload.meal);
				await writeMealsToDexie([meal], entry);
				await rewritePendingMealIds(payload.meal.id, meal);
				return;
			}
			if (error instanceof ScheduleMealClientError && error.status === 404) {
				if (entry.attempts < maxMissingMealUpdateAttempts) throw error;
				await deleteMealFromDexie(payload.meal.id, entry);
				return;
			}
			throw error;
		}
		return;
	}
	throw new Error(`Unsupported planned meal operation: ${entry.operation}`);
};

const syncRecipeEntry = async (entry: SyncOutboxEntry) => {
	const payload = payloadRecord(entry) as RecipePayload;
	if (entry.operation === 'create') {
		const recipe = await createMenuRecipeRemote(payload);
		await writeRecipesToDexie([recipe], entry);
		await rewritePendingMealRecipeIds(entry.entityId, recipe.id);
		return;
	}
	if (entry.operation === 'update') {
		if (!payload.recipe) throw new Error('Missing recipe payload for update outbox entry.');
		const recipe = await updateMenuRecipeRemote(payload.recipe);
		await writeRecipesToDexie([recipe], entry);
		return;
	}
	const recipeIds = payload.recipeIds ?? entry.entityId.split(',').filter(Boolean);
	if (entry.operation === 'archive') {
		try {
			await archiveMenuRecipesRemote(recipeIds);
		} catch (error) {
			if (isNotFoundError(error)) return;
			throw error;
		}
		return;
	}
	if (entry.operation === 'restore') {
		try {
			const recipes = await restoreMenuRecipesRemote(recipeIds);
			await writeRecipesToDexie(recipes, entry);
		} catch (error) {
			if (isNotFoundError(error)) return;
			throw error;
		}
		return;
	}
	if (entry.operation === 'delete') {
		try {
			await permanentlyDeleteMenuRecipesRemote(recipeIds);
		} catch (error) {
			if (isNotFoundError(error)) return;
			throw error;
		}
		return;
	}
	throw new Error(`Unsupported recipe operation: ${entry.operation}`);
};

const syncOutboxEntry = async (entry: SyncOutboxEntry) => {
	logClientDbDebug('dexie->d1', 'flush outbox entry', {
		scope: entry,
		payload: { operation: entry.operation, entityType: entry.entityType, entityId: entry.entityId }
	});
	if (entry.entityType === 'plannedMeal') {
		await syncMealEntry(entry);
		return;
	}
	if (entry.entityType === 'recipe') {
		await syncRecipeEntry(entry);
		return;
	}
	throw new Error(`Unsupported outbox entity type: ${entry.entityType}`);
};

export const flushClientDbOutbox = async () => {
	if (!browser || flushing) return;
	const db = getClientDb();
	if (!db) return;
	flushing = true;
	try {
		while (true) {
			const dueAt = Date.now();
			const entry = (await db.syncOutbox.where('nextAttemptAt').belowOrEqual(dueAt).toArray()).sort(
				(left, right) =>
					outboxPriority(left) - outboxPriority(right) || left.createdAt - right.createdAt
			)[0];
			if (!entry?.id) return;
			try {
				await syncOutboxEntry(entry);
				await db.syncOutbox.delete(entry.id);
				logClientDbDebug('dexie->d1', 'flushed outbox entry', {
					scope: entry,
					payload: {
						operation: entry.operation,
						entityType: entry.entityType,
						entityId: entry.entityId
					}
				});
			} catch (error) {
				const attempts = entry.attempts + 1;
				await db.syncOutbox.update(entry.id, {
					attempts,
					nextAttemptAt: Date.now() + backoffMs(attempts)
				});
				console.error('Failed to flush client DB outbox entry', error);
			}
		}
	} finally {
		flushing = false;
	}
};

export const scheduleClientDbOutboxFlush = () => {
	if (!browser) return;
	if (flushTimer) clearTimeout(flushTimer);
	flushTimer = setTimeout(() => {
		flushTimer = null;
		void flushClientDbOutbox();
	}, flushDebounceMs);
};

export const startClientDbOutboxWorker = () => {
	if (!browser || started) return;
	started = true;
	scheduleClientDbOutboxFlush();
	retryTimer = setInterval(() => void flushClientDbOutbox(), retryIntervalMs);
	window.addEventListener('online', scheduleClientDbOutboxFlush);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') scheduleClientDbOutboxFlush();
	});
};

export const stopClientDbOutboxWorker = () => {
	if (!browser) return;
	if (flushTimer) clearTimeout(flushTimer);
	if (retryTimer) clearInterval(retryTimer);
	flushTimer = null;
	retryTimer = null;
	started = false;
};
