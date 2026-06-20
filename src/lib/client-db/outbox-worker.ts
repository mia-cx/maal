import { browser } from '$app/environment';
import {
	createScheduleMealRemote,
	deleteScheduleMealRemote,
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
import { writeMealsToDexie, writeRecipesToDexie } from './repositories';
import type { SyncOutboxEntry } from './schema';

const flushDebounceMs = 1_500;
const retryIntervalMs = 30_000;
const maxBackoffMs = 5 * 60_000;

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

const payloadRecord = (entry: SyncOutboxEntry): Record<string, unknown> =>
	entry.payload && typeof entry.payload === 'object'
		? (entry.payload as Record<string, unknown>)
		: {};

const syncMealEntry = async (entry: SyncOutboxEntry) => {
	const payload = payloadRecord(entry) as MealPayload;
	if (entry.operation === 'delete') {
		await deleteScheduleMealRemote(payload.mealId ?? entry.entityId);
		return;
	}
	if (!payload.meal) throw new Error(`Missing meal payload for ${entry.operation} outbox entry.`);
	if (entry.operation === 'create') {
		const meal = await createScheduleMealRemote(payload.meal);
		await writeMealsToDexie([meal], entry);
		return;
	}
	if (entry.operation === 'update') {
		await updateScheduleMealRemote(payload.meal);
		return;
	}
	throw new Error(`Unsupported planned meal operation: ${entry.operation}`);
};

const syncRecipeEntry = async (entry: SyncOutboxEntry) => {
	const payload = payloadRecord(entry) as RecipePayload;
	if (entry.operation === 'create') {
		const recipe = await createMenuRecipeRemote(payload);
		await writeRecipesToDexie([recipe], entry);
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
		await archiveMenuRecipesRemote(recipeIds);
		return;
	}
	if (entry.operation === 'restore') {
		const recipes = await restoreMenuRecipesRemote(recipeIds);
		await writeRecipesToDexie(recipes, entry);
		return;
	}
	if (entry.operation === 'delete') {
		await permanentlyDeleteMenuRecipesRemote(recipeIds);
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
		const dueAt = Date.now();
		const entries = await db.syncOutbox
			.where('nextAttemptAt')
			.belowOrEqual(dueAt)
			.sortBy('createdAt');
		for (const entry of entries) {
			if (!entry.id) continue;
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
