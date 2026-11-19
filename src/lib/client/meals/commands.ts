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
	copyRecipeIntoMeal,
	freezesBeforeRecipeChange,
	householdToday,
	planRecipeFollowingMeal,
	type PlanMealOptions
} from '$lib/domain/meals/recipe-following.js';
import {
	MEAL_CONFLICT_GROUPS,
	MEAL_COPY_GROUPS,
	MealAggregateSchema,
	MealCheckInSchema,
	MealStatusSchema,
	MealVerdictSchema,
	StoredMealSchema,
	isLiveMeal,
	isRecipeFollowingMeal,
	type LiveMeal,
	type MealAggregate,
	type MealCheckIn,
	type MealStatus,
	type MealVerdict,
	type RecipeFollowingMeal,
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

export type { PlanMealOptions };

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

const requireMeal = (record: unknown, householdId: string, operation: string): LiveMeal => {
	const stored = decode(StoredMealSchema, record, operation);
	if (!isLiveMeal(stored) || stored.householdId !== householdId || stored.deletedAt !== null) {
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

/** Reads the recipe a recipe-following meal shows. A deleted recipe still has its content. */
const requireFollowedRecipe = async (
	database: MaalDatabase,
	meal: RecipeFollowingMeal,
	operation: string
): Promise<RecipeAggregate> => {
	const stored = decode(
		StoredRecipeSchema,
		await database.recipes.get(meal.sourceRecipeId),
		operation
	);
	if (!isRecipeAggregate(stored)) {
		throw new LocalDecodeError({ operation, message: 'The recipe of this meal is not available.' });
	}
	return stored;
};

/** Decodes a committed meal of either kind, resolved the way readers show it. */
const decodeResolvedMeal = async (
	database: MaalDatabase,
	aggregate: unknown,
	operation: string
): Promise<MealAggregate> => {
	const meal = requireLiveMeal(decode(StoredMealSchema, aggregate, operation), operation);
	if (!isRecipeFollowingMeal(meal)) return meal;
	return copyRecipeIntoMeal(meal, await requireFollowedRecipe(database, meal, operation));
};

const requireLiveMeal = (stored: StoredMeal, operation: string): LiveMeal => {
	if (!isLiveMeal(stored)) {
		throw new LocalDecodeError({ operation, message: 'The meal was purged.' });
	}
	return stored;
};

/**
 * Builds the command that copies `recipe` into a recipe-following meal (spec §5.3). It owns the
 * `source` group and every content group, so an edit committed after it in the same transaction is a
 * separate mutation that the Worker applies even when another device copied first. `overrides` apply
 * to the copy, for example the null provenance of a purge.
 */
export const mealCopyCommand = (
	context: Omit<MealCommandContext, 'householdId'>,
	meal: RecipeFollowingMeal,
	recipe: RecipeAggregate,
	overrides: Partial<Pick<MealAggregate, 'sourceRecipeId'>> = {}
): LocalCommand => {
	const occurredAt = commandTime(context);
	return {
		authSlotId: context.authSlotId,
		scopeKind: 'household',
		scopeId: meal.householdId,
		entityKind: 'meal',
		aggregateId: meal.id,
		conflictGroup: 'source',
		operation: 'upsert',
		originDeviceId: context.originDeviceId,
		occurredAt,
		// Minted now, so the copy sorts ahead of any edit built after it with the same timestamp.
		mutationId: uuidv7(),
		payload: {
			mealId: meal.id,
			conflictGroups: [...MEAL_COPY_GROUPS],
			patch: { followsRecipe: false, ...overrides }
		},
		payloadSchema: MealMutationPayloadSchema,
		writes: [
			{
				store: 'meals',
				aggregateId: meal.id,
				conflictGroups: MEAL_COPY_GROUPS,
				schema: StoredMealSchema,
				update: (current) => {
					const live = requireMeal(current, meal.householdId, 'copy recipe into meal');
					// Another tab may have copied it since this command was built; keep that copy.
					if (!isRecipeFollowingMeal(live)) return { ...live, ...overrides };
					return { ...copyRecipeIntoMeal(live, recipe), ...overrides };
				}
			}
		]
	};
};

/**
 * The copy that must precede an edit of a meal's recipe fields: one command for a recipe-following
 * meal, none for a meal copy. Commit it in the same transaction, ahead of the edit.
 */
export const copyBeforeEditCommands = async (
	database: MaalDatabase,
	context: MealCommandContext,
	mealId: string
): Promise<LocalCommand[]> => {
	const meal = requireMeal(await database.meals.get(mealId), context.householdId, 'read meal');
	if (!isRecipeFollowingMeal(meal)) return [];
	return [mealCopyCommand(context, meal, await requireFollowedRecipe(database, meal, 'copy meal'))];
};

/** Builds the command that plans `recipe` as a new recipe-following meal; callers may commit it with other commands. */
export const planMealCommand = (
	context: MealCommandContext,
	recipe: RecipeAggregate,
	options: PlanMealOptions = {},
	mealId = uuidv7()
): LocalCommand => {
	const occurredAt = commandTime(context);
	const id = decode(DomainIdSchema, mealId, 'decode meal ID');
	const snapshot = planRecipeFollowingMeal({
		recipe,
		householdId: context.householdId,
		mealId: id,
		occurredAt,
		options
	});
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
	return decodeResolvedMeal(database, result.aggregates[0], 'decode planned meal');
};

export const mealScheduleCommand = (
	context: MealCommandContext,
	mealId: string,
	patch: MealSchedulePatch
): LocalCommand => {
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
	return {
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
	};
};

export const updateMealSchedule = async (
	database: MaalDatabase,
	context: MealCommandContext,
	mealId: string,
	patch: MealSchedulePatch
): Promise<MealAggregate> => {
	const result = await executeLocalCommand(database, mealScheduleCommand(context, mealId, patch));
	return decodeResolvedMeal(database, result.aggregates[0], 'decode scheduled meal');
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
	return Promise.all(
		results.map((result) =>
			decodeResolvedMeal(database, result.aggregates[0], 'decode reordered meal')
		)
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
 * Builds the command for the meal sheet's own fields (title, description, cook minutes) under the `header`
 * conflict group. The sheet only offers them for custom meals with no source recipe. A
 * recipe-following meal needs {@link copyBeforeEditCommands} ahead of it; {@link mealHeaderCommands}
 * builds both.
 */
export const mealHeaderCommand = (
	context: MealCommandContext,
	mealId: string,
	patch: MealHeaderPatch
): LocalCommand => {
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
	return {
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
				update: (current) => {
					const meal = requireMeal(current, context.householdId, 'update meal header');
					if (isRecipeFollowingMeal(meal)) {
						throw new LocalDecodeError({
							operation: 'update meal header',
							message: 'A recipe-following meal is copied before its header changes.'
						});
					}
					return { ...meal, ...decodedPatch };
				}
			}
		]
	};
};

/** The header edit of a meal, preceded by its copy when the meal still follows its recipe. */
export const mealHeaderCommands = async (
	database: MaalDatabase,
	context: MealCommandContext,
	mealId: string,
	patch: MealHeaderPatch
): Promise<LocalCommand[]> => [
	...(await copyBeforeEditCommands(database, context, mealId)),
	mealHeaderCommand(context, mealId, patch)
];

export const updateMealHeader = async (
	database: MaalDatabase,
	context: MealCommandContext,
	mealId: string,
	patch: MealHeaderPatch
): Promise<MealAggregate> => {
	const results = await executeLocalCommands(
		database,
		await mealHeaderCommands(database, context, mealId, patch)
	);
	return decode(MealAggregateSchema, results.at(-1)!.aggregates[0], 'decode meal header update');
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
	return decodeResolvedMeal(database, result.aggregates[0], 'decode meal status update');
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
	// A check-in copies a recipe-following meal first, so history shows what was cooked. The copy's
	// mutation ID is older than the check-in's, so it is sent first.
	const copy = await copyBeforeEditCommands(database, { ...context, occurredAt }, mealId);
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
	const results = await executeLocalCommands(database, [
		...copy,
		{
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
		}
	]);
	const result = results.at(-1)!;
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

/** The command that nulls the provenance of a meal copy whose recipe is purged (spec §5.3). */
const provenanceDetachCommand = (
	context: Omit<MealCommandContext, 'householdId'>,
	meal: LiveMeal
): LocalCommand => ({
	authSlotId: context.authSlotId,
	scopeKind: 'household',
	scopeId: meal.householdId,
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
				...requireMeal(current, meal.householdId, 'detach recipe provenance'),
				sourceRecipeId: null
			})
		}
	]
});

/**
 * Freezes the meals on this device that must not see a change to `recipe`, the version before it
 * (spec §5.3), in every household. On a deletion, every recipe-following meal. On an edit, those
 * cooked, skipped, or dated before today in their household, and every one in a household that no
 * longer changes with the recipe: a detached snapshot, where no profile on this device is still an
 * active member, or one the recipe's owner left. A purge also nulls the provenance of every meal
 * copy of the recipe. Deleted meals are skipped.
 *
 * A meal in a household where `uploader` is an active member freezes through a command that uploads.
 * Every other meal is written on this device only: a detached snapshot never uploads, and in a
 * household that syncs, the Worker or the device that made the change uploads the same copy. Run it
 * through `executeRecipeChange`, which calls it ahead of every recipe write.
 */
export const freezeMealsBeforeRecipeChange = async (
	database: MaalDatabase,
	recipe: RecipeAggregate,
	change: 'edit' | 'delete' | 'purge',
	uploader?: Omit<MealCommandContext, 'householdId'>
): Promise<void> => {
	const meals = (await database.meals.where('sourceRecipeId').equals(recipe.id).toArray())
		.map((row) => decode(StoredMealSchema, row, 'decode meal of recipe'))
		.filter((row): row is LiveMeal => isLiveMeal(row) && row.deletedAt === null);
	if (meals.length === 0) return;
	const now = new Date(uploader ? commandTime(uploader) : Date.now());
	const householdIds = [...new Set(meals.map(({ householdId }) => householdId))];
	const timeZones = new Map(
		(await database.households.bulkGet(householdIds))
			.filter((household) => household !== undefined)
			.map(({ householdId, timezone }) => [householdId, timezone])
	);
	const memberships = await database.memberships.where('householdId').anyOf(householdIds).toArray();
	const householdsOf = (rows: typeof memberships) => new Set(rows.map((row) => row.householdId));
	const active = memberships.filter(({ status }) => status === 'active');
	const live = householdsOf(active);
	// Local members but no active one is a detached snapshot; one the owner left stops following too.
	const stopsFollowing = householdsOf(
		memberships.filter(
			({ householdId, workosUserId, status }) =>
				!live.has(householdId) || (workosUserId === recipe.ownerUserId && status !== 'active')
		)
	);
	const writable = householdsOf(
		active.filter(({ workosUserId }) => workosUserId === uploader?.reporterUserId)
	);
	const frozen = meals.filter((meal) =>
		isRecipeFollowingMeal(meal)
			? change !== 'edit' ||
				stopsFollowing.has(meal.householdId) ||
				freezesBeforeRecipeChange(
					meal,
					householdToday(now, timeZones.get(meal.householdId) ?? null)
				)
			: change === 'purge'
	);
	const overrides = change === 'purge' ? { sourceRecipeId: null } : {};
	const commands: LocalCommand[] = [];
	for (const meal of frozen) {
		if (uploader !== undefined && writable.has(meal.householdId)) {
			commands.push(
				isRecipeFollowingMeal(meal)
					? mealCopyCommand(uploader, meal, recipe, overrides)
					: provenanceDetachCommand(uploader, meal)
			);
			continue;
		}
		await database.meals.put({
			...(isRecipeFollowingMeal(meal) ? copyRecipeIntoMeal(meal, recipe) : meal),
			...overrides
		});
	}
	if (commands.length > 0) await executeLocalCommands(database, commands);
};
