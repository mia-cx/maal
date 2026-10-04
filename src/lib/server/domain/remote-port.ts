import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import {
	MEAL_CONFLICT_GROUPS,
	MealAggregateSchema,
	MealCheckInSchema,
	type MealAggregate,
	type MealCheckIn
} from '$lib/domain/meals/schema.js';
import {
	RECIPE_CONFLICT_GROUPS,
	RecipeAggregateSchema,
	RecipeImportedCandidateSchema,
	type RecipeAggregate,
	type RecipeImportedCandidate
} from '$lib/domain/recipes/schema.js';
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
	listHouseholdMeals(householdId: string): Promise<readonly MealAggregate[]>;
	getHouseholdMeal(householdId: string, mealId: string): Promise<MealAggregate | null>;
	writeHouseholdMeal(input: {
		actorUserId: string;
		householdId: string;
		aggregate: MealAggregate;
		conflictGroups: readonly string[];
		operation: 'upsert' | 'delete';
	}): Promise<MealAggregate>;
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

const mealFromSnapshot = (value: unknown): MealAggregate | null => {
	try {
		const decoded = Schema.decodeUnknownSync(MealAggregateSchema)(value);
		return decoded.deletedAt === null ? decoded : null;
	} catch {
		return null;
	}
};

export class D1RemoteDomainPort implements RemoteDomainPort {
	private readonly users: D1UserSyncRepository;
	private readonly households: D1HouseholdSyncRepository;

	constructor(private readonly database: D1Database) {
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
		const snapshot = await this.users.bootstrap(ownerUserId);
		return snapshot.aggregates
			.filter(({ entityKind }) => entityKind === 'recipe')
			.map(({ aggregate }) => {
				try {
					const decoded = Schema.decodeUnknownSync(RecipeAggregateSchema)(aggregate);
					return decoded;
				} catch {
					return null;
				}
			})
			.filter((recipe): recipe is RecipeAggregate => recipe !== null);
	}

	async getUserRecipe(ownerUserId: string, recipeId: string): Promise<RecipeAggregate | null> {
		return (await this.listUserRecipes(ownerUserId)).find(({ id }) => id === recipeId) ?? null;
	}

	async writeUserRecipe(input: {
		actorUserId: string;
		aggregate: RecipeAggregate;
		conflictGroups: readonly string[];
		operation: 'upsert' | 'delete';
	}): Promise<RecipeAggregate> {
		const now = new Date().toISOString() as `${string}Z`;
		const receipt = await this.users.commit({
			actorUserId: input.actorUserId,
			deviceId: uuidv7(),
			mutation: {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId: uuidv7(),
				originDeviceId: uuidv7(),
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
		const result = await this.getUserRecipe(input.actorUserId, input.aggregate.id);
		if (!result) throw new RemoteDomainError('not_found', 'The written recipe was not found.');
		return result;
	}

	async listHouseholdMeals(householdId: string): Promise<readonly MealAggregate[]> {
		const snapshot = await this.households.bootstrap(householdId);
		return snapshot.aggregates
			.filter(({ entityKind }) => entityKind === 'meal')
			.map(({ aggregate }) => mealFromSnapshot(aggregate))
			.filter((meal): meal is MealAggregate => meal !== null);
	}

	async getHouseholdMeal(householdId: string, mealId: string): Promise<MealAggregate | null> {
		return (await this.listHouseholdMeals(householdId)).find(({ id }) => id === mealId) ?? null;
	}

	async writeHouseholdMeal(input: {
		actorUserId: string;
		householdId: string;
		aggregate: MealAggregate;
		conflictGroups: readonly string[];
		operation: 'upsert' | 'delete';
	}): Promise<MealAggregate> {
		const now = new Date().toISOString() as `${string}Z`;
		const receipt = await this.households.commit({
			householdId: input.householdId,
			actorUserId: input.actorUserId,
			deviceId: uuidv7(),
			mutation: {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId: uuidv7(),
				originDeviceId: uuidv7(),
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
		if (input.operation === 'delete') return input.aggregate;
		const result = await this.getHouseholdMeal(input.householdId, input.aggregate.id);
		if (!result) throw new RemoteDomainError('not_found', 'The written meal was not found.');
		return result;
	}

	async getMealCheckIn(
		householdId: string,
		mealId: string,
		reporterUserId: string
	): Promise<MealCheckIn | null> {
		const snapshot = await this.households.bootstrap(householdId);
		for (const change of snapshot.aggregates) {
			if (change.entityKind !== 'meal_check_in') continue;
			try {
				const row = Schema.decodeUnknownSync(MealCheckInSchema)(change.aggregate);
				if (
					row.mealId === mealId &&
					row.reporterUserId === reporterUserId &&
					row.deletedAt === null
				) {
					return row;
				}
			} catch {
				// A corrupt unrelated row cannot widen or satisfy the query.
			}
		}
		return null;
	}

	async listMealCheckIns(householdId: string, mealId?: string): Promise<readonly MealCheckIn[]> {
		const snapshot = await this.households.bootstrap(householdId);
		return snapshot.aggregates
			.filter(({ entityKind }) => entityKind === 'meal_check_in')
			.map(({ aggregate }) => {
				try {
					return Schema.decodeUnknownSync(MealCheckInSchema)(aggregate);
				} catch {
					return null;
				}
			})
			.filter(
				(row): row is MealCheckIn =>
					row !== null && row.deletedAt === null && (!mealId || row.mealId === mealId)
			);
	}

	async writeMealCheckIn(input: {
		actorUserId: string;
		householdId: string;
		aggregate: MealCheckIn;
	}): Promise<MealCheckIn> {
		const now = new Date().toISOString() as `${string}Z`;
		const receipt = await this.households.commit({
			householdId: input.householdId,
			actorUserId: input.actorUserId,
			deviceId: uuidv7(),
			mutation: {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId: uuidv7(),
				originDeviceId: uuidv7(),
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
		const result = await this.getMealCheckIn(
			input.householdId,
			input.aggregate.mealId ?? '',
			input.actorUserId
		);
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
		const snapshot = await this.users.bootstrap(ownerUserId);
		for (const change of snapshot.aggregates) {
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
		const receipt = await this.users.commit({
			actorUserId: input.actorUserId,
			deviceId: uuidv7(),
			mutation: {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				mutationId: uuidv7(),
				originDeviceId: uuidv7(),
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
		const result = (await this.getUserFoodProfile(input.actorUserId)).userFoodPreferences.find(
			({ id }) => id === input.aggregate.id
		);
		if (!result)
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

export const cloneRecipeAsMeal = (input: {
	recipe: RecipeAggregate;
	householdId: string;
	date?: string | null;
	time?: string | null;
	plannedCookUserId?: string | null;
	plannedYield?: number | null;
	mealId?: string;
	now?: `${string}Z`;
}): MealAggregate => {
	const now = input.now ?? (new Date().toISOString() as `${string}Z`);
	const instructionIds = new Map<string, string>();
	const instructions = input.recipe.instructions.map((instruction) => {
		const id = uuidv7();
		instructionIds.set(instruction.id, id);
		return { ...instruction, id };
	});
	return decode(
		MealAggregateSchema,
		{
			...input.recipe,
			id: input.mealId ?? uuidv7(),
			householdId: input.householdId,
			sourceRecipeId: input.recipe.id,
			date: input.date ?? null,
			time: input.time ?? null,
			sortOrder: null,
			plannedCookUserId: input.plannedCookUserId ?? null,
			plannedYield:
				input.plannedYield ??
				(input.recipe.yield === null ? null : Math.max(1, Math.round(input.recipe.yield))),
			status: 'planned',
			notes: input.recipe.userNotes,
			revision: 0,
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			conflictClocks: {},
			ingredients: input.recipe.ingredients.map((row) => ({ ...row, id: uuidv7() })),
			instructions,
			instructionEvents: input.recipe.instructionEvents.map((row) => ({
				...row,
				id: uuidv7(),
				mealInstructionId: instructionIds.get(row.recipeInstructionId)
			})),
			applianceRequirements: input.recipe.applianceRequirements.map((row) => ({
				...row,
				id: uuidv7()
			})),
			classifications: input.recipe.classifications.map((row) => ({ ...row, id: uuidv7() })),
			media: input.recipe.media.map((row) => ({ ...row, id: uuidv7() })),
			nutritionFacts: input.recipe.nutritionFacts.map((row) => ({ ...row, id: uuidv7() })),
			ownerUserId: undefined,
			userNotes: undefined,
			searchTokens: undefined,
			savedFromHouseholdId: undefined
		},
		'Meal aggregate'
	);
};

const recipeCopyHeader = (value: RecipeAggregate | MealAggregate) => ({
	title: value.title,
	description: value.description,
	imageUrl: value.imageUrl,
	yield: value.yield,
	prepTimeMinutes: value.prepTimeMinutes,
	cookTimeMinutes: value.cookTimeMinutes,
	totalTimeMinutes: value.totalTimeMinutes,
	sourceYieldText: value.sourceYieldText,
	sourceDatePublished: value.sourceDatePublished,
	sourceDateModified: value.sourceDateModified,
	sourceLanguage: value.sourceLanguage,
	sourceUrl: value.sourceUrl,
	sourceSiteName: value.sourceSiteName,
	sourceAuthorName: value.sourceAuthorName,
	sourcePublisherName: value.sourcePublisherName,
	sourceIsBasedOnUrl: value.sourceIsBasedOnUrl,
	sourceImportedAt: value.sourceImportedAt,
	sourceHtmlHash: value.sourceHtmlHash,
	sourceRatingValue: value.sourceRatingValue,
	sourceRatingCount: value.sourceRatingCount,
	sourceReviewCount: value.sourceReviewCount,
	sourceClaimedMinutes: value.sourceClaimedMinutes,
	parseConfidence: value.parseConfidence,
	ingredientConfidence: value.ingredientConfidence,
	instructionConfidence: value.instructionConfidence,
	nutritionConfidence: value.nutritionConfidence
});

const semanticSidecars = (value: unknown): string =>
	JSON.stringify(value, (key, item: unknown) =>
		['id', 'createdAt', 'updatedAt', 'recipeInstructionId', 'mealInstructionId'].includes(key)
			? undefined
			: item
	);

export const linkedMealMatchesRecipeSnapshot = (
	meal: MealAggregate,
	recipe: RecipeAggregate
): boolean =>
	meal.sourceRecipeId === recipe.id &&
	JSON.stringify(recipeCopyHeader(meal)) === JSON.stringify(recipeCopyHeader(recipe)) &&
	semanticSidecars(meal.ingredients) === semanticSidecars(recipe.ingredients) &&
	semanticSidecars(meal.instructions) === semanticSidecars(recipe.instructions) &&
	semanticSidecars(meal.instructionEvents) === semanticSidecars(recipe.instructionEvents) &&
	semanticSidecars(meal.applianceRequirements) === semanticSidecars(recipe.applianceRequirements) &&
	semanticSidecars(meal.classifications) === semanticSidecars(recipe.classifications) &&
	semanticSidecars(meal.media) === semanticSidecars(recipe.media) &&
	semanticSidecars(meal.nutritionFacts) === semanticSidecars(recipe.nutritionFacts);

export const propagateRecipeUpdateToLinkedMeals = async (input: {
	domain: RemoteDomainPort;
	actorUserId: string;
	householdIds: readonly string[];
	previous: RecipeAggregate;
	next: RecipeAggregate;
}): Promise<number> => {
	let updated = 0;
	for (const householdId of input.householdIds) {
		const meals = await input.domain.listHouseholdMeals(householdId);
		for (const meal of meals) {
			if (
				meal.status !== 'planned' ||
				meal.deletedAt !== null ||
				!linkedMealMatchesRecipeSnapshot(meal, input.previous)
			) {
				continue;
			}
			const propagated = cloneRecipeAsMeal({
				recipe: input.next,
				householdId,
				mealId: meal.id,
				date: meal.date,
				time: meal.time,
				plannedCookUserId: meal.plannedCookUserId,
				plannedYield: meal.plannedYield
			});
			await input.domain.writeHouseholdMeal({
				actorUserId: input.actorUserId,
				householdId,
				aggregate: {
					...propagated,
					sortOrder: meal.sortOrder,
					status: meal.status,
					notes: meal.notes,
					revision: meal.revision,
					createdAt: meal.createdAt,
					deletedAt: meal.deletedAt,
					conflictClocks: meal.conflictClocks
				},
				conflictGroups: [
					'header',
					'ingredients',
					'instructions',
					'appliances',
					'classifications',
					'media',
					'nutrition'
				],
				operation: 'upsert'
			});
			updated += 1;
		}
	}
	return updated;
};

export const allRecipeConflictGroups = RECIPE_CONFLICT_GROUPS;
export const allMealConflictGroups = MEAL_CONFLICT_GROUPS;
