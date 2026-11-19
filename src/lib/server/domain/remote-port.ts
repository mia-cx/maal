import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import {
	copyRecipeIntoMeal,
	planRecipeFollowingMeal,
	resolveMealVersion
} from '$lib/domain/meals/recipe-following.js';
import {
	MEAL_CONFLICT_GROUPS,
	MEAL_COPY_GROUPS,
	MealAggregateSchema,
	MealCheckInSchema,
	StoredMealSchema,
	isLiveMeal,
	isRecipeFollowingMeal,
	type LiveMeal,
	type MealAggregate,
	type MealCheckIn,
	type RecipeFollowingMeal
} from '$lib/domain/meals/schema.js';
import {
	RECIPE_CONFLICT_GROUPS,
	RecipeAggregateSchema,
	RecipeImportedCandidateSchema,
	type RecipeAggregate,
	type RecipeImportedCandidate
} from '$lib/domain/recipes/schema.js';
import { recipeVersion } from '$lib/domain/recipes/versions.js';
import {
	FoodUserAliasSchema,
	FoodUserEntrySchema,
	UnitUserAliasSchema,
	UnitUserEntrySchema,
	UserFoodDisplayPreferenceSchema,
	UserFoodPreferenceSchema,
	UserUnitDisplayPreferenceSchema,
	type FoodUserAlias,
	type FoodUserEntry,
	type UnitUserAlias,
	type UnitUserEntry,
	type UserFoodDisplayPreference,
	type UserFoodPreference,
	type UserUnitDisplayPreference
} from '$lib/domain/taxonomy/schema.js';
import { D1HouseholdSyncRepository } from '$lib/server/sync/household-d1-repository.js';
import { D1UserSyncRepository } from '$lib/server/sync/d1-repository.js';
import { loadMealResolution, readRecipeVersions } from '$lib/server/sync/recipe-versions.js';

export interface RemoteHouseholdSummary {
	readonly id: string;
	readonly name: string;
	readonly locale: string;
	readonly timezone: string | null;
}

export interface RemoteFoodProfile {
	readonly foodUserAliases: readonly FoodUserAlias[];
	readonly foodUserEntries: readonly FoodUserEntry[];
	readonly unitUserAliases: readonly UnitUserAlias[];
	readonly unitUserEntries: readonly UnitUserEntry[];
	readonly userFoodPreferences: readonly UserFoodPreference[];
	readonly userFoodDisplayPreferences: readonly UserFoodDisplayPreference[];
	readonly userUnitDisplayPreferences: readonly UserUnitDisplayPreference[];
}

/**
 * A meal as tools show it: a recipe-following meal with the content of the version it resolves to,
 * that version's ID, and `followsRecipe: true`; or a meal copy with `followsRecipe: false` and no
 * version (spec §7.4).
 */
export type RemoteMeal = MealAggregate & {
	readonly followsRecipe: boolean;
	readonly recipeVersionId: string | null;
};

export interface RemoteDomainPort {
	listHouseholds(householdIds: readonly string[]): Promise<readonly RemoteHouseholdSummary[]>;
	listUserRecipes(ownerUserId: string): Promise<readonly RecipeAggregate[]>;
	getUserRecipe(ownerUserId: string, recipeId: string): Promise<RecipeAggregate | null>;
	writeUserRecipe(input: {
		actorUserId: string;
		aggregate: RecipeAggregate;
		conflictGroups: readonly string[];
		operation: 'upsert' | 'delete';
	}): Promise<RecipeAggregate>;
	/** Gives a recipe stored before versions existed its first version, as planning does (§5.2). */
	ensureRecipeVersion(actorUserId: string, recipe: RecipeAggregate): Promise<void>;
	listHouseholdMeals(householdId: string): Promise<readonly RemoteMeal[]>;
	getHouseholdMeal(householdId: string, mealId: string): Promise<RemoteMeal | null>;
	/** Commits one meal mutation and returns the meal as tools show it, or null once deleted. */
	writeHouseholdMeal(input: {
		actorUserId: string;
		householdId: string;
		aggregate: LiveMeal;
		conflictGroups: readonly string[];
		operation: 'upsert' | 'delete';
	}): Promise<RemoteMeal | null>;
	getMealCheckIn(
		householdId: string,
		mealId: string,
		reporterUserId: string
	): Promise<MealCheckIn | null>;
	listMealCheckIns(householdId: string, mealId?: string): Promise<readonly MealCheckIn[]>;
	writeMealCheckIn(input: {
		actorUserId: string;
		householdId: string;
		aggregate: MealCheckIn;
	}): Promise<MealCheckIn>;
	getUserFoodProfile(ownerUserId: string): Promise<RemoteFoodProfile>;
	writeUserFoodPreference(input: {
		actorUserId: string;
		aggregate: UserFoodPreference;
	}): Promise<UserFoodPreference>;
}

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown, name: string): A => {
	try {
		return Schema.decodeUnknownSync(schema)(value);
	} catch {
		throw new RemoteDomainError('invalid_domain_payload', `${name} did not match its contract.`);
	}
};

export class RemoteDomainError extends Error {
	readonly _tag = 'RemoteDomainError';
	constructor(
		readonly code: 'invalid_domain_payload' | 'write_rejected' | 'not_found',
		message: string
	) {
		super(message);
	}
}

/** Decodes a stored aggregate, or null when it is missing or does not match its contract. */
const fromSnapshot = <A, I>(schema: Schema.Schema<A, I>, value: unknown): A | null => {
	try {
		return Schema.decodeUnknownSync(schema)(value);
	} catch {
		return null;
	}
};

const recipeFromSnapshot = (value: unknown): RecipeAggregate | null =>
	fromSnapshot(RecipeAggregateSchema, value);

const checkInFromSnapshot = (value: unknown): MealCheckIn | null => {
	const decoded = fromSnapshot(MealCheckInSchema, value);
	return decoded?.deletedAt === null ? decoded : null;
};

const FOOD_PROFILE_KINDS = [
	'foodUserAlias',
	'foodUserEntry',
	'unitUserAlias',
	'unitUserEntry',
	'userFoodPreference',
	'userFoodDisplayPreference',
	'userUnitDisplayPreference'
] as const;

/**
 * Runs MCP domain commands against D1. Every write is attributed to `deviceId`, so pass one
 * stable ID per caller (the MCP key ID) to keep `sync_devices` to one row per key.
 */
export class D1RemoteDomainPort implements RemoteDomainPort {
	private readonly users: D1UserSyncRepository;
	private readonly households: D1HouseholdSyncRepository;

	constructor(
		private readonly database: D1Database,
		private readonly deviceId: string
	) {
		this.users = new D1UserSyncRepository(database);
		this.households = new D1HouseholdSyncRepository(database);
	}

	async listHouseholds(
		householdIds: readonly string[]
	): Promise<readonly RemoteHouseholdSummary[]> {
		if (householdIds.length === 0) return [];
		const placeholders = householdIds.map(() => '?').join(', ');
		return (
			await this.database
				.prepare(
					`SELECT household_id AS id, household_id AS name, locale, timezone FROM households
					 WHERE household_id IN (${placeholders}) AND deleted_at IS NULL
					 ORDER BY household_id`
				)
				.bind(...householdIds)
				.all<RemoteHouseholdSummary>()
		).results;
	}

	async listUserRecipes(ownerUserId: string): Promise<readonly RecipeAggregate[]> {
		const changes = await this.users.readEntitiesOfKinds(ownerUserId, ['recipe']);
		return changes
			.map(({ aggregate }) => recipeFromSnapshot(aggregate))
			.filter((recipe): recipe is RecipeAggregate => recipe !== null);
	}

	async getUserRecipe(ownerUserId: string, recipeId: string): Promise<RecipeAggregate | null> {
		const [change] = await this.users.readEntities(ownerUserId, [
			{ entityKind: 'recipe', entityId: recipeId }
		]);
		return change ? recipeFromSnapshot(change.aggregate) : null;
	}

	async writeUserRecipe(input: {
		actorUserId: string;
		aggregate: RecipeAggregate;
		conflictGroups: readonly string[];
		operation: 'upsert' | 'delete';
	}): Promise<RecipeAggregate> {
		const now = new Date().toISOString() as `${string}Z`;
		const { receipt, aggregate } = await this.users.commitWithResult({
			actorUserId: input.actorUserId,
			deviceId: this.deviceId,
			mutation: {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId: uuidv7(),
				originDeviceId: this.deviceId,
				entityKind: 'recipe',
				entityId: input.aggregate.id,
				conflictGroups: [...input.conflictGroups] as [string, ...string[]],
				operation: input.operation,
				occurredAt: now,
				aggregate: input.aggregate
			},
			mode: 'live',
			receivedAt: now
		});
		if (receipt.status === 'rejected') {
			throw new RemoteDomainError('write_rejected', 'The recipe command was rejected.');
		}
		if (input.operation === 'delete') return input.aggregate;
		const result = recipeFromSnapshot(aggregate);
		if (!result) throw new RemoteDomainError('not_found', 'The written recipe was not found.');
		return result;
	}

	/**
	 * The first version of a recipe stored before versions existed, which planning adds (spec §5.2).
	 * Nothing happens when D1 holds a version of it.
	 */
	async ensureRecipeVersion(actorUserId: string, recipe: RecipeAggregate): Promise<void> {
		if ((await readRecipeVersions(this.database, [recipe.id])).length > 0) return;
		const now = new Date().toISOString() as `${string}Z`;
		const version = recipeVersion({
			id: uuidv7(),
			recipeId: recipe.id,
			ownerUserId: recipe.ownerUserId,
			effectiveAt: recipe.updatedAt,
			recipe
		});
		const { receipt } = await this.users.commitWithResult({
			actorUserId,
			deviceId: this.deviceId,
			mutation: {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId: uuidv7(),
				originDeviceId: this.deviceId,
				entityKind: 'recipeVersion',
				entityId: version.id,
				conflictGroups: ['row'],
				operation: 'upsert',
				occurredAt: version.effectiveAt,
				aggregate: version
			},
			mode: 'live',
			receivedAt: now
		});
		if (receipt.status === 'rejected') {
			throw new RemoteDomainError('write_rejected', 'The recipe version was rejected.');
		}
	}

	/**
	 * Resolves stored meals the way tools show them: a recipe-following meal with the version it
	 * resolves to (spec §5.3). Deleted, purged, and unresolvable meals are left out.
	 */
	private async resolveMeals(values: readonly unknown[]): Promise<RemoteMeal[]> {
		const meals = values
			.map((value) => fromSnapshot(StoredMealSchema, value))
			.filter(
				(meal): meal is LiveMeal => meal !== null && isLiveMeal(meal) && meal.deletedAt === null
			);
		const contextOf = await loadMealResolution(this.database, meals);
		return meals.flatMap((meal): RemoteMeal[] => {
			if (!isRecipeFollowingMeal(meal)) {
				return [{ ...meal, followsRecipe: false, recipeVersionId: null }];
			}
			const version = resolveMealVersion(meal, contextOf(meal));
			if (version === null) return [];
			return [
				{
					...copyRecipeIntoMeal(meal, version.recipe),
					followsRecipe: true,
					recipeVersionId: version.id
				}
			];
		});
	}

	async listHouseholdMeals(householdId: string): Promise<readonly RemoteMeal[]> {
		const changes = await this.households.readEntitiesOfKinds(householdId, ['meal']);
		return this.resolveMeals(changes.map(({ aggregate }) => aggregate));
	}

	async getHouseholdMeal(householdId: string, mealId: string): Promise<RemoteMeal | null> {
		const [change] = await this.households.readEntities(householdId, [
			{ entityKind: 'meal', entityId: mealId }
		]);
		return change ? ((await this.resolveMeals([change.aggregate]))[0] ?? null) : null;
	}

	async writeHouseholdMeal(input: {
		actorUserId: string;
		householdId: string;
		aggregate: LiveMeal;
		conflictGroups: readonly string[];
		operation: 'upsert' | 'delete';
	}): Promise<RemoteMeal | null> {
		const now = new Date().toISOString() as `${string}Z`;
		const { receipt, aggregate } = await this.households.commitWithResult({
			householdId: input.householdId,
			actorUserId: input.actorUserId,
			deviceId: this.deviceId,
			mutation: {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId: uuidv7(),
				originDeviceId: this.deviceId,
				entityKind: 'meal',
				entityId: input.aggregate.id,
				conflictGroups: [...input.conflictGroups] as [string, ...string[]],
				operation: input.operation,
				occurredAt: now,
				aggregate: input.aggregate
			},
			mode: 'live',
			receivedAt: now
		});
		if (receipt.status === 'rejected') {
			throw new RemoteDomainError('write_rejected', 'The meal command was rejected.');
		}
		if (input.operation === 'delete') return null;
		const [result] = await this.resolveMeals([aggregate]);
		if (!result) throw new RemoteDomainError('not_found', 'The written meal was not found.');
		return result;
	}

	async getMealCheckIn(
		householdId: string,
		mealId: string,
		reporterUserId: string
	): Promise<MealCheckIn | null> {
		const [checkIn] = await this.readMealCheckIns(householdId, { mealId, reporterUserId });
		return checkIn ?? null;
	}

	listMealCheckIns(householdId: string, mealId?: string): Promise<readonly MealCheckIn[]> {
		return this.readMealCheckIns(householdId, { mealId });
	}

	/** Finds live check-in IDs in the normalized table, then reads only those aggregates. */
	private async readMealCheckIns(
		householdId: string,
		filter: { mealId?: string; reporterUserId?: string }
	): Promise<MealCheckIn[]> {
		const { results } = await this.database
			.prepare(
				`SELECT id FROM meal_check_ins
				 WHERE household_id = ?1 AND deleted_at IS NULL
				 AND (?2 IS NULL OR meal_id = ?2) AND (?3 IS NULL OR reporter_user_id = ?3)
				 ORDER BY id`
			)
			.bind(householdId, filter.mealId ?? null, filter.reporterUserId ?? null)
			.all<{ id: string }>();
		const changes = await this.households.readEntities(
			householdId,
			results.map(({ id }) => ({ entityKind: 'meal_check_in' as const, entityId: id }))
		);
		return changes
			.map(({ aggregate }) => checkInFromSnapshot(aggregate))
			.filter(
				(row): row is MealCheckIn =>
					row !== null &&
					// Re-apply the filters: the check-in may have moved between the
					// ID listing and this aggregate read.
					(filter.mealId === undefined || row.mealId === filter.mealId) &&
					(filter.reporterUserId === undefined || row.reporterUserId === filter.reporterUserId)
			);
	}

	async writeMealCheckIn(input: {
		actorUserId: string;
		householdId: string;
		aggregate: MealCheckIn;
	}): Promise<MealCheckIn> {
		const now = new Date().toISOString() as `${string}Z`;
		const { receipt, aggregate } = await this.households.commitWithResult({
			householdId: input.householdId,
			actorUserId: input.actorUserId,
			deviceId: this.deviceId,
			mutation: {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId: uuidv7(),
				originDeviceId: this.deviceId,
				entityKind: 'meal_check_in',
				entityId: input.aggregate.id,
				conflictGroups: ['response'],
				operation: 'upsert',
				occurredAt: now,
				aggregate: input.aggregate
			},
			mode: 'live',
			receivedAt: now
		});
		if (receipt.status === 'rejected') {
			throw new RemoteDomainError('write_rejected', 'The check-in command was rejected.');
		}
		const result = checkInFromSnapshot(aggregate);
		if (!result) throw new RemoteDomainError('not_found', 'The written check-in was not found.');
		return result;
	}

	async getUserFoodProfile(ownerUserId: string): Promise<RemoteFoodProfile> {
		const profile: {
			foodUserAliases: FoodUserAlias[];
			foodUserEntries: FoodUserEntry[];
			unitUserAliases: UnitUserAlias[];
			unitUserEntries: UnitUserEntry[];
			userFoodPreferences: UserFoodPreference[];
			userFoodDisplayPreferences: UserFoodDisplayPreference[];
			userUnitDisplayPreferences: UserUnitDisplayPreference[];
		} = {
			foodUserAliases: [],
			foodUserEntries: [],
			unitUserAliases: [],
			unitUserEntries: [],
			userFoodPreferences: [],
			userFoodDisplayPreferences: [],
			userUnitDisplayPreferences: []
		};
		const changes = await this.users.readEntitiesOfKinds(ownerUserId, FOOD_PROFILE_KINDS);
		for (const change of changes) {
			try {
				switch (change.entityKind) {
					case 'foodUserAlias':
						profile.foodUserAliases.push(
							Schema.decodeUnknownSync(FoodUserAliasSchema)(change.aggregate)
						);
						break;
					case 'foodUserEntry':
						profile.foodUserEntries.push(
							Schema.decodeUnknownSync(FoodUserEntrySchema)(change.aggregate)
						);
						break;
					case 'unitUserAlias':
						profile.unitUserAliases.push(
							Schema.decodeUnknownSync(UnitUserAliasSchema)(change.aggregate)
						);
						break;
					case 'unitUserEntry':
						profile.unitUserEntries.push(
							Schema.decodeUnknownSync(UnitUserEntrySchema)(change.aggregate)
						);
						break;
					case 'userFoodPreference':
						profile.userFoodPreferences.push(
							Schema.decodeUnknownSync(UserFoodPreferenceSchema)(change.aggregate)
						);
						break;
					case 'userFoodDisplayPreference':
						profile.userFoodDisplayPreferences.push(
							Schema.decodeUnknownSync(UserFoodDisplayPreferenceSchema)(change.aggregate)
						);
						break;
					case 'userUnitDisplayPreference':
						profile.userUnitDisplayPreferences.push(
							Schema.decodeUnknownSync(UserUnitDisplayPreferenceSchema)(change.aggregate)
						);
						break;
				}
			} catch {
				// Corrupt unrelated rows cannot appear in the public profile.
			}
		}
		return {
			foodUserAliases: profile.foodUserAliases.filter(({ deletedAt }) => deletedAt === null),
			foodUserEntries: profile.foodUserEntries.filter(({ deletedAt }) => deletedAt === null),
			unitUserAliases: profile.unitUserAliases.filter(({ deletedAt }) => deletedAt === null),
			unitUserEntries: profile.unitUserEntries.filter(({ deletedAt }) => deletedAt === null),
			userFoodPreferences: profile.userFoodPreferences.filter(
				({ deletedAt }) => deletedAt === null
			),
			userFoodDisplayPreferences: profile.userFoodDisplayPreferences.filter(
				({ deletedAt }) => deletedAt === null
			),
			userUnitDisplayPreferences: profile.userUnitDisplayPreferences.filter(
				({ deletedAt }) => deletedAt === null
			)
		};
	}

	async writeUserFoodPreference(input: {
		actorUserId: string;
		aggregate: UserFoodPreference;
	}): Promise<UserFoodPreference> {
		const now = new Date().toISOString() as `${string}Z`;
		const { receipt, aggregate } = await this.users.commitWithResult({
			actorUserId: input.actorUserId,
			deviceId: this.deviceId,
			mutation: {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId: uuidv7(),
				originDeviceId: this.deviceId,
				entityKind: 'userFoodPreference',
				entityId: input.aggregate.id,
				conflictGroups: ['row'],
				operation: 'upsert',
				occurredAt: now,
				aggregate: input.aggregate
			},
			mode: 'live',
			receivedAt: now
		});
		if (receipt.status === 'rejected') {
			throw new RemoteDomainError('write_rejected', 'The food preference command was rejected.');
		}
		const result = fromSnapshot(UserFoodPreferenceSchema, aggregate);
		if (result?.deletedAt !== null)
			throw new RemoteDomainError('not_found', 'The written food preference was not found.');
		return result;
	}
}

export const createRecipeAggregate = (input: {
	ownerUserId: string;
	candidate: RecipeImportedCandidate;
	recipeId?: string;
	now?: `${string}Z`;
}): RecipeAggregate => {
	const now = input.now ?? (new Date().toISOString() as `${string}Z`);
	const candidate = decode(RecipeImportedCandidateSchema, input.candidate, 'Recipe candidate');
	return decode(
		RecipeAggregateSchema,
		{
			...candidate,
			schemaVersion: CURRENT_SCHEMA_VERSION,
			revision: 0,
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			conflictClocks: {},
			id: input.recipeId ?? uuidv7(),
			ownerUserId: input.ownerUserId,
			searchTokens: recipeSearchTokens(candidate)
		},
		'Recipe aggregate'
	);
};

export const recipeSearchTokens = (recipe: RecipeImportedCandidate): string[] => [
	...new Set(
		[
			recipe.title,
			recipe.description,
			recipe.sourceSiteName,
			recipe.sourceAuthorName,
			...recipe.ingredients.flatMap(({ sourceFoodLabel, originalText }) => [
				sourceFoodLabel,
				originalText
			]),
			...recipe.classifications.flatMap(({ value, normalizedValue }) => [value, normalizedValue])
		]
			.filter((value): value is string => value !== null)
			.flatMap((value) =>
				value
					.normalize('NFKD')
					.replace(/[\u0300-\u036f]/g, '')
					.toLocaleLowerCase()
					.split(/[^\p{L}\p{N}]+/u)
					.filter(Boolean)
			)
	)
];

/** Plans `recipe` as a new recipe-following meal in `householdId` (spec §5.3). */
export const followRecipeAsMeal = (input: {
	recipe: RecipeAggregate;
	householdId: string;
	date?: string | null;
	time?: string | null;
	plannedCookUserId?: string | null;
	plannedYield?: number | null;
	mealId?: string;
	now?: `${string}Z`;
}): RecipeFollowingMeal =>
	planRecipeFollowingMeal({
		recipe: input.recipe,
		householdId: input.householdId,
		mealId: input.mealId ?? uuidv7(),
		occurredAt: input.now ?? new Date().toISOString(),
		options: {
			date: input.date ?? null,
			time: input.time ?? null,
			plannedCookUserId: input.plannedCookUserId ?? null,
			plannedYield: input.plannedYield ?? null
		}
	});

/**
 * The meal copy of a meal a tool is about to change. A recipe-following meal is copied first, as
 * its own mutation (spec §5.3); a meal copy is returned as it is.
 */
export const copyMealBeforeEdit = async (input: {
	domain: RemoteDomainPort;
	actorUserId: string;
	householdId: string;
	meal: RemoteMeal;
}): Promise<RemoteMeal> => {
	if (!input.meal.followsRecipe) return input.meal;
	const copied = await input.domain.writeHouseholdMeal({
		actorUserId: input.actorUserId,
		householdId: input.householdId,
		aggregate: mealCopyOf(input.meal),
		conflictGroups: MEAL_COPY_GROUPS,
		operation: 'upsert'
	});
	if (!copied) throw new RemoteDomainError('not_found', 'The copied meal was not found.');
	return copied;
};

/** The stored meal copy behind a meal a tool read. Decoding drops the `followsRecipe` flag. */
export const mealCopyOf = (meal: RemoteMeal): MealAggregate =>
	decode(MealAggregateSchema, meal, 'Meal aggregate');

export const allRecipeConflictGroups = RECIPE_CONFLICT_GROUPS;
export const allMealConflictGroups = MEAL_CONFLICT_GROUPS;
