import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import {
	executeLocalCommand,
	executeLocalCommands,
	type LocalCommand
} from '$lib/client/local/commands.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import { resolveLocalHouseholdSyncCapability } from '$lib/client/sync/household-capability.js';
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
	type MealVerdict,
	type StoredMeal
} from '$lib/domain/meals/schema.js';
import {
	StoredRecipeSchema,
	isRecipeAggregate,
	type RecipeAggregate
} from '$lib/domain/recipes/schema.js';

import { mealTombstone } from './retention.js';

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

const commandTime = (context: Pick<MealCommandContext, 'occurredAt'>): UtcInstant =>
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

/** Builds the command that plans `recipe` as a new meal; callers may commit it with other commands. */
export const planMealCommand = (
	context: MealCommandContext,
	recipe: RecipeAggregate,
	options: PlanMealOptions = {},
	mealId = uuidv7()
): LocalCommand => {
	const occurredAt = commandTime(context);
	const id = decode(DomainIdSchema, mealId, 'decode meal ID');
	const snapshot = clonedRecipeSnapshot(recipe, context.householdId, id, occurredAt, options);
	return {
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
			patch: { sourceRecipeId: recipe.id, ...options }
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
	};
};

export const planRecipeAsMeal = async (
	database: MaalDatabase,
	context: MealCommandContext,
	recipeId: string,
	options: PlanMealOptions = {},
	mealId = uuidv7()
): Promise<MealAggregate> => {
	const recipe = requireRecipe(await database.recipes.get(recipeId), 'read recipe for meal');
	const result = await executeLocalCommand(
		database,
		planMealCommand(context, recipe, options, mealId)
	);
	return decode(MealAggregateSchema, result.aggregates[0], 'decode planned meal');
};

const mealScheduleCommand = (
	context: MealCommandContext,
	mealId: string,
	patch: MealSchedulePatch
): LocalCommand => {
	const decodedPatch = {
		date: decode(NullableDateSchema, patch.date, 'decode meal date'),
		time: decode(NullableTimeSchema, patch.time, 'decode meal time'),
		sortOrder: patch.sortOrder === null ? null : Math.max(0, Math.round(patch.sortOrder)),
		...(patch.plannedCookUserId !== undefined
			? { plannedCookUserId: patch.plannedCookUserId }
			: {}),
		...(patch.plannedYield !== undefined ? { plannedYield: patch.plannedYield } : {})
	};
	return {
		authSlotId: context.authSlotId,
		scopeKind: 'household',
		scopeId: context.householdId,
		entityKind: 'meal',
		aggregateId: mealId,
		conflictGroup: 'schedule',
		operation: 'upsert',
		originDeviceId: context.originDeviceId,
		occurredAt: commandTime(context),
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
	};
};

export const updateMealSchedule = async (
	database: MaalDatabase,
	context: MealCommandContext,
	mealId: string,
	patch: MealSchedulePatch
): Promise<MealAggregate> => {
	const result = await executeLocalCommand(database, mealScheduleCommand(context, mealId, patch));
	return decode(MealAggregateSchema, result.aggregates[0], 'decode scheduled meal');
};

/**
 * Commits every move of one drag gesture in a single transaction, so a mid-batch failure leaves no
 * partial order behind. Returns the reordered aggregates in move order.
 */
export const reorderMeals = async (
	database: MaalDatabase,
	context: MealCommandContext,
	moves: readonly { mealId: string; patch: MealSchedulePatch }[]
): Promise<MealAggregate[]> => {
	const occurredAt = commandTime(context);
	const results = await executeLocalCommands(
		database,
		moves.map(({ mealId, patch }) => mealScheduleCommand({ ...context, occurredAt }, mealId, patch))
	);
	return results.map((result) =>
		decode(MealAggregateSchema, result.aggregates[0], 'decode reordered meal')
	);
};

export interface MealHeaderPatch {
	title: string;
	description: string | null;
	cookTimeMinutes: number | null;
}

const MealHeaderPatchSchema = Schema.Struct({
	title: Schema.String.pipe(Schema.minLength(1)),
	description: NullableStringSchema,
	cookTimeMinutes: Schema.NullOr(Schema.NonNegativeInt)
});

/**
 * Saves the meal sheet's own fields (title, description, cook minutes) under the `header`
 * conflict group. The sheet only offers them for custom meals with no source recipe.
 */
export const updateMealHeader = async (
	database: MaalDatabase,
	context: MealCommandContext,
	mealId: string,
	patch: MealHeaderPatch
): Promise<MealAggregate> => {
	const occurredAt = commandTime(context);
	const decodedPatch = decode(
		MealHeaderPatchSchema,
		{
			title: patch.title.trim(),
			description: patch.description?.trim() || null,
			cookTimeMinutes: patch.cookTimeMinutes
		},
		'decode meal header'
	);
	const result = await executeLocalCommand(database, {
		authSlotId: context.authSlotId,
		scopeKind: 'household',
		scopeId: context.householdId,
		entityKind: 'meal',
		aggregateId: mealId,
		conflictGroup: 'header',
		operation: 'upsert',
		originDeviceId: context.originDeviceId,
		occurredAt,
		payload: { mealId, conflictGroups: ['header'], patch: decodedPatch },
		payloadSchema: MealMutationPayloadSchema,
		writes: [
			{
				store: 'meals',
				aggregateId: mealId,
				conflictGroups: ['header'],
				schema: StoredMealSchema,
				update: (current) => ({
					...requireMeal(current, context.householdId, 'update meal header'),
					...decodedPatch
				})
			}
		]
	});
	return decode(MealAggregateSchema, result.aggregates[0], 'decode meal header update');
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
	const checkInMutationId = uuidv7();
	const mealStatusMutationId = uuidv7();
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
		mutationId: checkInMutationId,
		additionalMutations: [
			{
				mutationId: mealStatusMutationId,
				entityKind: 'meal',
				aggregateId: mealId,
				conflictGroup: 'status',
				operation: 'upsert'
			}
		],
		payload,
		payloadSchema: MealCheckInPayloadSchema,
		writes: [
			{
				store: 'meals',
				aggregateId: mealId,
				mutationId: mealStatusMutationId,
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

/**
 * Deletes a meal and detaches its check-ins. When the household does not sync for this user, no remote
 * acknowledgement will come, so the content is removed at once and only the minimal tombstone is kept.
 * Synced content waits for `runMealRetention` after the server acknowledges the deletion.
 */
export const deleteMeal = async (
	database: MaalDatabase,
	context: MealCommandContext,
	mealId: string
): Promise<StoredMeal> => {
	const occurredAt = commandTime(context);
	const { enabled: synced } = await resolveLocalHouseholdSyncCapability(
		database,
		context.reporterUserId,
		context.householdId,
		new Date(occurredAt)
	);
	// Only a check-in's reporter may upload it, so only those get a clock and an outbox row. Other
	// reporters' check-ins are detached locally; the server nulls their meal reference on delete.
	const checkIns = (await database.mealCheckIns.where('mealId').equals(mealId).toArray()).map(
		(row) => ({
			id: row.id,
			mutationId: row.reporterUserId === context.reporterUserId ? uuidv7() : undefined
		})
	);
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
		additionalMutations: checkIns.flatMap(({ id, mutationId }) =>
			mutationId === undefined
				? []
				: [
						{
							mutationId,
							entityKind: 'meal_check_in',
							aggregateId: id,
							conflictGroup: 'response',
							operation: 'upsert' as const
						}
					]
		),
		payload: { mealId, conflictGroups: ['deletion'], patch: { deletedAt: occurredAt } },
		payloadSchema: MealMutationPayloadSchema,
		writes: [
			{
				store: 'meals',
				aggregateId: mealId,
				conflictGroups: ['deletion'],
				schema: StoredMealSchema,
				update: (current) => {
					const deleted = {
						...requireMeal(current, context.householdId, 'delete meal'),
						deletedAt: occurredAt
					};
					return synced ? deleted : mealTombstone(deleted, occurredAt);
				}
			},
			...checkIns.map(({ id, mutationId }) => ({
				store: 'mealCheckIns' as const,
				aggregateId: id,
				mutationId,
				conflictGroups: mutationId === undefined ? [] : ['response'],
				schema: MealCheckInSchema,
				update: (current: unknown) => ({
					...decode(MealCheckInSchema, current, 'detach deleted meal check-in'),
					mealId: null
				})
			}))
		]
	});
	return decode(StoredMealSchema, result.aggregates[0], 'decode deleted meal');
};

/**
 * Builds the commands that null `sourceRecipeId` on every live meal copied from a purged recipe, across
 * the households the recipe owner (`reporterUserId`) belongs to. Deleted meals are skipped: their
 * content is on its way out and they cannot be edited. Commit these with the purge in one transaction.
 */
export const recipeProvenanceDetachCommands = async (
	database: MaalDatabase,
	context: Omit<MealCommandContext, 'householdId'>,
	recipeId: string
): Promise<LocalCommand[]> => {
	const occurredAt = commandTime(context);
	// Detached snapshots are read-only and never upload, so only active memberships are touched.
	const memberships = await database.memberships
		.where('workosUserId')
		.equals(context.reporterUserId)
		.filter(({ status }) => status === 'active')
		.toArray();
	const commands: LocalCommand[] = [];
	for (const { householdId } of memberships) {
		const linked = (await database.meals.where('householdId').equals(householdId).toArray())
			.map((row) => decode(StoredMealSchema, row, 'decode meal provenance'))
			.filter(
				(row): row is MealAggregate =>
					isMealAggregate(row) && row.deletedAt === null && row.sourceRecipeId === recipeId
			);
		for (const meal of linked) {
			commands.push({
				authSlotId: context.authSlotId,
				scopeKind: 'household',
				scopeId: householdId,
				entityKind: 'meal',
				aggregateId: meal.id,
				conflictGroup: 'header',
				operation: 'upsert',
				originDeviceId: context.originDeviceId,
				occurredAt,
				payload: { mealId: meal.id, conflictGroups: ['header'], patch: { sourceRecipeId: null } },
				payloadSchema: MealMutationPayloadSchema,
				writes: [
					{
						store: 'meals',
						aggregateId: meal.id,
						conflictGroups: ['header'],
						schema: StoredMealSchema,
						update: (current) => ({
							...requireMeal(current, householdId, 'detach recipe provenance'),
							sourceRecipeId: null
						})
					}
				]
			});
		}
	}
	return commands;
};
