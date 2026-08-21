import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import { executeLocalCommand } from '$lib/client/local/commands.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import { LocalDecodeError } from '$lib/domain/contracts/errors.js';
import {
	DomainIdSchema,
	LocalDateSchema,
	LocalTimeSchema,
	UtcInstantSchema,
	type UtcInstant
} from '$lib/domain/contracts/primitives.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import {
	MEAL_CONFLICT_GROUPS,
	MealAggregateSchema,
	MealCheckInSchema,
	MealStatusSchema,
	MealVerdictSchema,
	StoredMealSchema,
	isMealAggregate,
	type MealAggregate,
	type MealCheckIn,
	type MealStatus,
	type MealVerdict
} from '$lib/domain/meals/schema.js';
import {
	StoredRecipeSchema,
	isRecipeAggregate,
	type RecipeAggregate
} from '$lib/domain/recipes/schema.js';

const NullableDateSchema = Schema.NullOr(LocalDateSchema);
const NullableTimeSchema = Schema.NullOr(LocalTimeSchema);
const NullableStringSchema = Schema.NullOr(Schema.String);
const NullablePositiveIntSchema = Schema.NullOr(Schema.Int.pipe(Schema.greaterThan(0)));

const MealMutationPayloadSchema = Schema.Struct({
	mealId: DomainIdSchema,
	conflictGroups: Schema.Array(Schema.String),
	patch: Schema.Unknown
});

const MealCheckInPayloadSchema = Schema.Struct({
	mealId: DomainIdSchema,
	checkInId: DomainIdSchema,
	status: MealStatusSchema,
	verdict: MealVerdictSchema,
	cookTimeMinutes: NullablePositiveIntSchema,
	reason: NullableStringSchema
});

export interface MealCommandContext {
	authSlotId: string;
	householdId: string;
	reporterUserId: string;
	originDeviceId: string;
	occurredAt?: UtcInstant;
}

export interface PlanMealOptions {
	date?: string | null;
	time?: string | null;
	sortOrder?: number | null;
	plannedCookUserId?: string | null;
	plannedYield?: number | null;
}

export interface MealSchedulePatch {
	date: string | null;
	time: string | null;
	sortOrder: number | null;
	plannedCookUserId?: string | null;
	plannedYield?: number | null;
}

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown, operation: string): A => {
	try {
		return Schema.decodeUnknownSync(schema)(value);
	} catch {
		throw new LocalDecodeError({ operation, message: 'Meal data did not match its contract.' });
	}
};

const commandTime = (context: MealCommandContext): UtcInstant =>
	decode(
		UtcInstantSchema,
		context.occurredAt ?? new Date().toISOString(),
		'decode meal mutation time'
	);

const requireMeal = (record: unknown, householdId: string, operation: string): MealAggregate => {
	const stored = decode(StoredMealSchema, record, operation);
	if (!isMealAggregate(stored) || stored.householdId !== householdId || stored.deletedAt !== null) {
		throw new LocalDecodeError({
			operation,
			message: 'The meal is not available in this household.'
		});
	}
	return stored;
};

const requireRecipe = (record: unknown, operation: string): RecipeAggregate => {
	const stored = decode(StoredRecipeSchema, record, operation);
	if (!isRecipeAggregate(stored) || stored.deletedAt !== null) {
		throw new LocalDecodeError({ operation, message: 'The recipe is not available.' });
	}
	return stored;
};

const clonedRecipeSnapshot = (
	recipe: RecipeAggregate,
	householdId: string,
	mealId: string,
	occurredAt: UtcInstant,
	options: PlanMealOptions
): MealAggregate => {
	const instructionIds = new Map<string, string>();
	const ingredients = recipe.ingredients.map((ingredient) => ({ ...ingredient, id: uuidv7() }));
	const instructions = recipe.instructions.map((instruction) => {
		const id = uuidv7();
		instructionIds.set(instruction.id, id);
		return { ...instruction, id };
	});
	return decode(
		MealAggregateSchema,
		{
			schemaVersion: CURRENT_SCHEMA_VERSION,
			revision: 0,
			createdAt: occurredAt,
			updatedAt: occurredAt,
			deletedAt: null,
			conflictClocks: {},
			id: mealId,
			householdId,
			sourceRecipeId: recipe.id,
			title: recipe.title,
			description: recipe.description,
			imageUrl: recipe.imageUrl,
			date: options.date ?? null,
			time: options.time ?? null,
			sortOrder: options.sortOrder ?? null,
			plannedCookUserId: options.plannedCookUserId ?? null,
			yield: recipe.yield,
			plannedYield:
				options.plannedYield ??
				(recipe.yield === null ? null : Math.max(1, Math.round(recipe.yield))),
			status: 'planned',
			prepTimeMinutes: recipe.prepTimeMinutes,
			cookTimeMinutes: recipe.cookTimeMinutes,
			totalTimeMinutes: recipe.totalTimeMinutes,
			sourceYieldText: recipe.sourceYieldText,
			sourceDatePublished: recipe.sourceDatePublished,
			sourceDateModified: recipe.sourceDateModified,
			sourceLanguage: recipe.sourceLanguage,
			sourceUrl: recipe.sourceUrl,
			sourceSiteName: recipe.sourceSiteName,
			sourceAuthorName: recipe.sourceAuthorName,
			sourcePublisherName: recipe.sourcePublisherName,
			sourceIsBasedOnUrl: recipe.sourceIsBasedOnUrl,
			sourceImportedAt: recipe.sourceImportedAt,
			sourceHtmlHash: recipe.sourceHtmlHash,
			sourceRatingValue: recipe.sourceRatingValue,
			sourceRatingCount: recipe.sourceRatingCount,
			sourceReviewCount: recipe.sourceReviewCount,
			sourceClaimedMinutes: recipe.sourceClaimedMinutes,
			parseConfidence: recipe.parseConfidence,
			ingredientConfidence: recipe.ingredientConfidence,
			instructionConfidence: recipe.instructionConfidence,
			nutritionConfidence: recipe.nutritionConfidence,
			notes: recipe.userNotes,
			ingredients,
			instructions,
			instructionEvents: recipe.instructionEvents.map((event) => ({
				...event,
				id: uuidv7(),
				mealInstructionId: instructionIds.get(event.recipeInstructionId)
			})),
			applianceRequirements: recipe.applianceRequirements.map((row) => ({
				...row,
				id: uuidv7()
			})),
			classifications: recipe.classifications.map((row) => ({ ...row, id: uuidv7() })),
			media: recipe.media.map((row) => ({ ...row, id: uuidv7() })),
			nutritionFacts: recipe.nutritionFacts.map((row) => ({ ...row, id: uuidv7() }))
		},
		'clone recipe into meal'
	);
};

export const planRecipeAsMeal = async (
	database: MaalDatabase,
	context: MealCommandContext,
	recipeId: string,
	options: PlanMealOptions = {},
	mealId = uuidv7()
): Promise<MealAggregate> => {
	const occurredAt = commandTime(context);
	const recipe = requireRecipe(await database.recipes.get(recipeId), 'read recipe for meal');
	const id = decode(DomainIdSchema, mealId, 'decode meal ID');
	const snapshot = clonedRecipeSnapshot(recipe, context.householdId, id, occurredAt, options);
	const result = await executeLocalCommand(database, {
		authSlotId: context.authSlotId,
		scopeKind: 'household',
		scopeId: context.householdId,
		entityKind: 'meal',
		aggregateId: id,
		conflictGroup: 'aggregate',
		operation: 'upsert',
		originDeviceId: context.originDeviceId,
		occurredAt,
		payload: {
			mealId: id,
			conflictGroups: [...MEAL_CONFLICT_GROUPS],
			patch: { sourceRecipeId: recipeId, ...options }
		},
		payloadSchema: MealMutationPayloadSchema,
		writes: [
			{
				store: 'meals',
				aggregateId: id,
				identity: { id, householdId: context.householdId },
				conflictGroups: MEAL_CONFLICT_GROUPS,
				schema: StoredMealSchema,
				update: (current) => {
					if (current !== undefined)
						throw new LocalDecodeError({
							operation: 'plan recipe',
							message: 'Meal ID already exists.'
						});
					return snapshot;
				}
			}
		]
	});
	return decode(MealAggregateSchema, result.aggregates[0], 'decode planned meal');
};

export const updateMealSchedule = async (
	database: MaalDatabase,
	context: MealCommandContext,
	mealId: string,
	patch: MealSchedulePatch
): Promise<MealAggregate> => {
	const occurredAt = commandTime(context);
	const decodedPatch = {
		date: decode(NullableDateSchema, patch.date, 'decode meal date'),
		time: decode(NullableTimeSchema, patch.time, 'decode meal time'),
		sortOrder: patch.sortOrder === null ? null : Math.max(0, Math.round(patch.sortOrder)),
		...(patch.plannedCookUserId !== undefined
			? { plannedCookUserId: patch.plannedCookUserId }
			: {}),
		...(patch.plannedYield !== undefined ? { plannedYield: patch.plannedYield } : {})
	};
	const result = await executeLocalCommand(database, {
		authSlotId: context.authSlotId,
		scopeKind: 'household',
		scopeId: context.householdId,
		entityKind: 'meal',
		aggregateId: mealId,
		conflictGroup: 'schedule',
		operation: 'upsert',
		originDeviceId: context.originDeviceId,
		occurredAt,
		payload: { mealId, conflictGroups: ['schedule'], patch: decodedPatch },
		payloadSchema: MealMutationPayloadSchema,
		writes: [
			{
				store: 'meals',
				aggregateId: mealId,
				conflictGroups: ['schedule'],
				schema: StoredMealSchema,
				update: (current) => ({
					...requireMeal(current, context.householdId, 'update meal schedule'),
					...decodedPatch
				})
			}
		]
	});
	return decode(MealAggregateSchema, result.aggregates[0], 'decode scheduled meal');
};

export const setMealStatus = async (
	database: MaalDatabase,
	context: MealCommandContext,
	mealId: string,
	statusInput: MealStatus
): Promise<MealAggregate> => {
	const occurredAt = commandTime(context);
	const status = decode(MealStatusSchema, statusInput, 'decode meal status');
	const result = await executeLocalCommand(database, {
		authSlotId: context.authSlotId,
		scopeKind: 'household',
		scopeId: context.householdId,
		entityKind: 'meal',
		aggregateId: mealId,
		conflictGroup: 'status',
		operation: 'upsert',
		originDeviceId: context.originDeviceId,
		occurredAt,
		payload: { mealId, conflictGroups: ['status'], patch: { status } },
		payloadSchema: MealMutationPayloadSchema,
		writes: [
			{
				store: 'meals',
				aggregateId: mealId,
				conflictGroups: ['status'],
				schema: StoredMealSchema,
				update: (current) => ({
					...requireMeal(current, context.householdId, 'update meal status'),
					status
				})
			}
		]
	});
	return decode(MealAggregateSchema, result.aggregates[0], 'decode meal status update');
};

export const saveMealCheckIn = async (
	database: MaalDatabase,
	context: MealCommandContext,
	mealId: string,
	input: {
		status: 'cooked' | 'skipped';
		verdict: MealVerdict;
		cookTimeMinutes?: number | null;
		reason?: string | null;
	}
): Promise<{ meal: MealAggregate; checkIn: MealCheckIn }> => {
	const occurredAt = commandTime(context);
	const existing = await database.mealCheckIns
		.where('[mealId+reporterUserId]')
		.equals([mealId, context.reporterUserId])
		.first();
	const checkInId = existing?.id ?? uuidv7();
	const payload = decode(
		MealCheckInPayloadSchema,
		{
			mealId,
			checkInId,
			status: input.status,
			verdict: input.verdict,
			cookTimeMinutes: input.cookTimeMinutes ?? null,
			reason: input.reason?.trim() || null
		},
		'decode meal check-in'
	);
	const checkInCandidate = {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		revision: 0,
		createdAt: occurredAt,
		updatedAt: occurredAt,
		deletedAt: null,
		conflictClocks: {},
		id: checkInId,
		reporterUserId: context.reporterUserId,
		mealId,
		cookTimeMinutes: payload.cookTimeMinutes,
		verdict: payload.verdict,
		reason: payload.reason
	} satisfies MealCheckIn;
	const result = await executeLocalCommand(database, {
		authSlotId: context.authSlotId,
		scopeKind: 'household',
		scopeId: context.householdId,
		entityKind: 'meal_check_in',
		aggregateId: checkInId,
		conflictGroup: 'response',
		operation: 'upsert',
		originDeviceId: context.originDeviceId,
		occurredAt,
		payload,
		payloadSchema: MealCheckInPayloadSchema,
		writes: [
			{
				store: 'meals',
				aggregateId: mealId,
				conflictGroups: ['status'],
				schema: StoredMealSchema,
				update: (current) => ({
					...requireMeal(current, context.householdId, 'check in meal'),
					status: payload.status
				})
			},
			{
				store: 'mealCheckIns',
				aggregateId: checkInId,
				identity: { id: checkInId, reporterUserId: context.reporterUserId, mealId },
				conflictGroups: ['response'],
				schema: MealCheckInSchema,
				update: (current) => ({
					...(current
						? decode(MealCheckInSchema, current, 'read prior check-in')
						: checkInCandidate),
					...checkInCandidate,
					createdAt: current
						? decode(MealCheckInSchema, current, 'read prior check-in').createdAt
						: occurredAt
				})
			}
		]
	});
	return {
		meal: decode(MealAggregateSchema, result.aggregates[0], 'decode checked-in meal'),
		checkIn: decode(MealCheckInSchema, result.aggregates[1], 'decode meal check-in result')
	};
};

export const deleteMeal = async (
	database: MaalDatabase,
	context: MealCommandContext,
	mealId: string
): Promise<MealAggregate> => {
	const occurredAt = commandTime(context);
	const checkIns = await database.mealCheckIns.where('mealId').equals(mealId).toArray();
	const result = await executeLocalCommand(database, {
		authSlotId: context.authSlotId,
		scopeKind: 'household',
		scopeId: context.householdId,
		entityKind: 'meal',
		aggregateId: mealId,
		conflictGroup: 'deletion',
		operation: 'delete',
		originDeviceId: context.originDeviceId,
		occurredAt,
		payload: { mealId, conflictGroups: ['deletion'], patch: { deletedAt: occurredAt } },
		payloadSchema: MealMutationPayloadSchema,
		writes: [
			{
				store: 'meals',
				aggregateId: mealId,
				conflictGroups: ['deletion'],
				schema: StoredMealSchema,
				update: (current) => ({
					...requireMeal(current, context.householdId, 'delete meal'),
					deletedAt: occurredAt
				})
			},
			...checkIns.map((row) => ({
				store: 'mealCheckIns' as const,
				aggregateId: row.id,
				conflictGroups: ['response'],
				schema: MealCheckInSchema,
				update: (current: unknown) => ({
					...decode(MealCheckInSchema, current, 'detach deleted meal check-in'),
					mealId: null
				})
			}))
		]
	});
	return decode(MealAggregateSchema, result.aggregates[0], 'decode deleted meal');
};

export const detachDeletedRecipeFromMeals = async (
	database: MaalDatabase,
	context: MealCommandContext,
	recipeId: string
): Promise<number> => {
	const candidates = (
		await database.meals.where('householdId').equals(context.householdId).toArray()
	)
		.map((row) => decode(StoredMealSchema, row, 'decode meal provenance'))
		.filter((row): row is MealAggregate => isMealAggregate(row) && row.sourceRecipeId === recipeId);
	for (const meal of candidates) {
		await executeLocalCommand(database, {
			authSlotId: context.authSlotId,
			scopeKind: 'household',
			scopeId: context.householdId,
			entityKind: 'meal',
			aggregateId: meal.id,
			conflictGroup: 'header',
			operation: 'upsert',
			originDeviceId: context.originDeviceId,
			occurredAt: commandTime(context),
			payload: { mealId: meal.id, conflictGroups: ['header'], patch: { sourceRecipeId: null } },
			payloadSchema: MealMutationPayloadSchema,
			writes: [
				{
					store: 'meals',
					aggregateId: meal.id,
					conflictGroups: ['header'],
					schema: StoredMealSchema,
					update: (current) => ({
						...requireMeal(current, context.householdId, 'detach recipe provenance'),
						sourceRecipeId: null
					})
				}
			]
		});
	}
	return candidates.length;
};
