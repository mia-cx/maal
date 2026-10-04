import { Schema } from 'effect';

import {
	HouseholdApplianceSchema,
	HouseholdSchema,
	MembershipSchema
} from '$lib/domain/household/contracts.js';
import { MealCheckInSchema, StoredMealSchema, isMealAggregate } from '$lib/domain/meals/schema.js';
import { PortableUserAttributionSchema } from '$lib/domain/portability/schema.js';
import { StoredRecipeSchema, isRecipeAggregate } from '$lib/domain/recipes/schema.js';
import {
	GLOBAL_FOOD_ALIAS_SEED,
	GLOBAL_FOOD_SEED,
	GLOBAL_UNIT_ALIAS_SEED,
	GLOBAL_UNIT_SEED
} from '$lib/domain/taxonomy/global-seed.js';
import {
	FoodAliasSchema,
	FoodHouseholdAliasSchema,
	FoodHouseholdEntrySchema,
	FoodSchema,
	FoodUserAliasSchema,
	FoodUserEntrySchema,
	HouseholdFoodDisplayPreferenceSchema,
	HouseholdUnitDisplayPreferenceSchema,
	UnitAliasSchema,
	UnitHouseholdAliasSchema,
	UnitHouseholdEntrySchema,
	UnitSchema,
	UnitUserAliasSchema,
	UnitUserEntrySchema,
	UserFoodDisplayPreferenceSchema,
	UserFoodPreferenceSchema,
	UserUnitDisplayPreferenceSchema
} from '$lib/domain/taxonomy/schema.js';

import {
	PORTABLE_SOURCE_STORES,
	buildPortableArchive,
	createPortableArchiveBlob,
	type PortableSource,
	type PortableUserAttribution
} from '$lib/client/portability/archive.js';

import {
	exportDecodableRecoveryData,
	type RecoveryDecoders,
	type RecoveryExport
} from './recovery.js';

const recoveryDecoders = {
	// Both branches strip secrets; damaged attribution can still identify a local user.
	profiles: Schema.Union(
		PortableUserAttributionSchema,
		Schema.Struct({ workosUserId: PortableUserAttributionSchema.fields.workosUserId })
	),
	households: HouseholdSchema,
	memberships: MembershipSchema,
	householdAppliances: HouseholdApplianceSchema,
	userAttributions: PortableUserAttributionSchema,
	recipes: StoredRecipeSchema,
	meals: StoredMealSchema,
	mealCheckIns: MealCheckInSchema,
	foods: FoodSchema,
	foodAliases: FoodAliasSchema,
	foodUserAliases: FoodUserAliasSchema,
	foodHouseholdAliases: FoodHouseholdAliasSchema,
	foodUserEntries: FoodUserEntrySchema,
	foodHouseholdEntries: FoodHouseholdEntrySchema,
	units: UnitSchema,
	unitAliases: UnitAliasSchema,
	unitUserAliases: UnitUserAliasSchema,
	unitHouseholdAliases: UnitHouseholdAliasSchema,
	unitUserEntries: UnitUserEntrySchema,
	unitHouseholdEntries: UnitHouseholdEntrySchema,
	userFoodPreferences: UserFoodPreferenceSchema,
	userFoodDisplayPreferences: UserFoodDisplayPreferenceSchema,
	householdFoodDisplayPreferences: HouseholdFoodDisplayPreferenceSchema,
	userUnitDisplayPreferences: UserUnitDisplayPreferenceSchema,
	householdUnitDisplayPreferences: HouseholdUnitDisplayPreferenceSchema
} satisfies RecoveryDecoders;

type RecoverySource = {
	[K in keyof PortableSource]: readonly (typeof recoveryDecoders)[K]['Type'][];
};

export interface RecoveryArchive {
	readonly workosUserId: string;
	readonly displayName: string;
	readonly blob: Blob;
}

export interface RecoveryArchiveExport {
	readonly archives: readonly RecoveryArchive[];
	/** Undecodable or omitted source rows, counted once across all archives. */
	readonly skipped: RecoveryExport['skipped'];
	/** Retained source rows with repairs, counted once across all archives. */
	readonly repaired: Readonly<Record<string, number>>;
	readonly unreadable: RecoveryExport['unreadable'];
}

const closeRecoverySource = (
	source: RecoverySource,
	exporterId: string,
	report: (store: keyof PortableSource, row: object, outcome: 'skipped' | 'repaired') => void
): RecoverySource => {
	const householdIds = new Set(
		source.memberships
			.filter((row) => row.workosUserId === exporterId && row.status !== 'revoked')
			.map((row) => row.householdId)
	);
	const households = source.households.filter(
		(row) => householdIds.has(row.householdId) && row.deletionState !== 'purged'
	);
	const readableHouseholdIds = new Set(households.map((row) => row.householdId));
	// Scope before resolving dependencies: another local user's taxonomy is not in this archive.
	const scoped = Object.fromEntries(
		PORTABLE_SOURCE_STORES.map((store) => [
			store,
			source[store].filter((row) => {
				if (store === 'userAttributions') return true;
				if ('workosUserId' in row) return row.workosUserId === exporterId;
				if ('ownerUserId' in row) return row.ownerUserId === exporterId;
				if ('householdId' in row) return householdIds.has(row.householdId);
				return true;
			})
		])
	) as unknown as RecoverySource;
	const closed: { -readonly [K in keyof RecoverySource]: RecoverySource[K] } = {
		...scoped,
		households
	};
	const repairStore = <K extends keyof RecoverySource>(
		store: K,
		repair: (row: RecoverySource[K][number]) => RecoverySource[K][number] | null
	): void => {
		closed[store] = closed[store].flatMap((row) => {
			const next = repair(row);
			if (next !== row) report(store, row, next === null ? 'skipped' : 'repaired');
			return next === null ? [] : [next];
		}) as RecoverySource[K];
	};
	const has = (ids: ReadonlySet<string>, id: string | null): boolean => id === null || ids.has(id);
	const clearPair = <A extends object>(
		row: A,
		first: keyof A,
		second: keyof A,
		ids: ReadonlySet<string>
	): A =>
		[row[first], row[second]].every((id) => id === null || ids.has(id as string))
			? row
			: { ...row, [first]: null, [second]: null };
	for (const store of PORTABLE_SOURCE_STORES) {
		if (store === 'households') continue;
		// Household rows require a readable household, not merely a cached membership.
		repairStore(store, (row) =>
			'householdId' in row && !readableHouseholdIds.has(row.householdId as string) ? null : row
		);
	}
	// Global rows are never imported. Only the bundled seed is available after a reset.
	const unitIds = new Set(GLOBAL_UNIT_SEED.map((row) => row.id));
	for (const store of ['unitUserEntries', 'unitHouseholdEntries'] as const) {
		const pending = [...closed[store]];
		const retained: (typeof pending)[number][] = [];
		// Preserve dependency order for the importer's ID remapping, pruning unresolvable chains.
		while (pending.length > 0) {
			const index = pending.findIndex(
				(row) => unitIds.has(row.baseUnitId) || row.baseUnitId === row.id
			);
			if (index === -1) break;
			const [row] = pending.splice(index, 1);
			retained.push(row);
			unitIds.add(row.id);
		}
		for (const row of pending) report(store, row, 'skipped');
		closed[store] = retained as never;
	}
	for (const store of ['foodUserEntries', 'foodHouseholdEntries'] as const) {
		repairStore(store, (row) =>
			clearPair(row, 'defaultMeasureUnitId', 'defaultMeasureBaseUnitId', unitIds)
		);
	}
	const foodIds = new Set([
		...GLOBAL_FOOD_SEED.map((row) => row.id),
		...closed.foodUserEntries.map((row) => row.id),
		...closed.foodHouseholdEntries.map((row) => row.id)
	]);
	for (const store of ['foodUserAliases', 'foodHouseholdAliases'] as const) {
		repairStore(store, (row) =>
			foodIds.has(row.foodId)
				? clearPair(row, 'defaultMeasureUnitId', 'defaultMeasureBaseUnitId', unitIds)
				: null
		);
	}
	for (const store of ['unitUserAliases', 'unitHouseholdAliases'] as const) {
		repairStore(store, (row) =>
			unitIds.has(row.unitId) && unitIds.has(row.baseUnitId) ? row : null
		);
	}
	const foodAliasIds = new Set([
		...GLOBAL_FOOD_ALIAS_SEED.map((row) => row.id),
		...closed.foodUserAliases.map((row) => row.id),
		...closed.foodHouseholdAliases.map((row) => row.id)
	]);
	const unitAliasIds = new Set([
		...GLOBAL_UNIT_ALIAS_SEED.map((row) => row.id),
		...closed.unitUserAliases.map((row) => row.id),
		...closed.unitHouseholdAliases.map((row) => row.id)
	]);
	repairStore('userFoodPreferences', (row) => (foodIds.has(row.foodId) ? row : null));
	for (const store of ['userFoodDisplayPreferences', 'householdFoodDisplayPreferences'] as const) {
		repairStore(store, (row) => {
			if (!foodIds.has(row.foodId)) return null;
			const next = clearPair(row, 'preferredMeasureUnitId', 'preferredMeasureBaseUnitId', unitIds);
			return has(foodAliasIds, next.preferredFoodAliasId)
				? next
				: { ...next, preferredFoodAliasId: null, preferredFoodAliasScope: null };
		});
	}
	for (const store of ['userUnitDisplayPreferences', 'householdUnitDisplayPreferences'] as const) {
		repairStore(store, (row) => {
			if (!unitIds.has(row.baseUnitId) || !unitIds.has(row.preferredUnitId)) return null;
			return has(unitAliasIds, row.preferredUnitAliasId)
				? row
				: { ...row, preferredUnitAliasId: null, preferredUnitAliasScope: null };
		});
	}
	const repairContent = <A extends typeof StoredRecipeSchema.Type | typeof StoredMealSchema.Type>(
		row: A
	): A => {
		if (!('ingredients' in row)) return row;
		const ingredients = row.ingredients.map((ingredient) => {
			const next = clearPair(ingredient, 'baseUnitId', 'baseUnitFamilyId', unitIds);
			const measured = next === ingredient ? next : { ...next, baseQuantity: null };
			return has(foodIds, measured.baseFoodId) ? measured : { ...measured, baseFoodId: null };
		});
		const instructionEvents = row.instructionEvents.filter(
			(event) => has(unitIds, event.unitId) && has(unitIds, event.baseUnitId)
		);
		const nutritionFacts = row.nutritionFacts.map((fact) => {
			const next = clearPair(fact, 'unitId', 'baseUnitId', unitIds);
			return next === fact ? fact : { ...next, amount: null, baseAmount: null };
		});
		return ingredients.some((item, index) => item !== row.ingredients[index]) ||
			instructionEvents.length !== row.instructionEvents.length ||
			nutritionFacts.some((item, index) => item !== row.nutritionFacts[index])
			? { ...row, ingredients, instructionEvents, nutritionFacts }
			: row;
	};
	closed.recipes = closed.recipes.filter(isRecipeAggregate);
	repairStore('recipes', (row) => {
		const next = repairContent(row);
		return isRecipeAggregate(next) && !has(readableHouseholdIds, next.savedFromHouseholdId)
			? { ...next, savedFromHouseholdId: null }
			: next;
	});
	closed.meals = closed.meals.filter((row) => isMealAggregate(row) && row.deletedAt === null);
	repairStore('meals', repairContent);
	const mealIds = new Set(closed.meals.map((row) => row.id));
	closed.mealCheckIns = source.mealCheckIns.filter(
		(row) => mealIds.has(row.mealId ?? '') || row.reporterUserId === exporterId
	);
	repairStore('mealCheckIns', (row) => (has(mealIds, row.mealId) ? row : { ...row, mealId: null }));
	return closed;
};

/**
 * Builds one portable archive per user with readable data, from the rows that still decode.
 * The importer accepts these after a reset. A profile row that no longer decodes does not hide
 * its user-scoped taxonomy, preferences, or recipes.
 */
export const exportRecoveryArchives = async (
	database: Parameters<typeof exportDecodableRecoveryData>[0]
): Promise<RecoveryArchiveExport> => {
	const recovery = await exportDecodableRecoveryData(database, recoveryDecoders);
	// Every list was decoded with its own store's schema, so it has that store's row shape.
	const source = Object.fromEntries(
		PORTABLE_SOURCE_STORES.map((store) => [store, recovery.records[store] ?? []])
	) as RecoverySource;
	const skipped = { ...recovery.skipped };
	const repaired: Record<string, number> = {};
	const reported = { skipped: new WeakSet<object>(), repaired: new WeakSet<object>() };
	const report = (
		store: keyof typeof recoveryDecoders,
		row: object,
		outcome: 'skipped' | 'repaired'
	): void => {
		if (reported[outcome].has(row)) return;
		reported[outcome].add(row);
		const counts = outcome === 'skipped' ? skipped : repaired;
		counts[store] = (counts[store] ?? 0) + 1;
	};
	const cached = new Map(source.userAttributions.map((user) => [user.workosUserId, user]));
	const profiles = (
		(recovery.records.profiles ?? []) as readonly (typeof recoveryDecoders.profiles.Type)[]
	).map((profile): PortableUserAttribution => {
		if ('displayName' in profile) return profile;
		report('profiles', profile, 'repaired');
		return (
			cached.get(profile.workosUserId) ?? {
				workosUserId: profile.workosUserId,
				displayName: profile.workosUserId,
				profilePictureUrl: null
			}
		);
	});
	const exporters = new Map(profiles.map((profile) => [profile.workosUserId, profile]));
	// User-scoped rows sync only to their owner. Memberships, attribution, household meals and
	// check-ins can cache other household members and are not evidence of a local user.
	const owners = [
		...source.recipes.map((row) => row.ownerUserId),
		...source.foodUserEntries.map((row) => row.workosUserId),
		...source.foodUserAliases.map((row) => row.workosUserId),
		...source.unitUserEntries.map((row) => row.workosUserId),
		...source.unitUserAliases.map((row) => row.workosUserId),
		...source.userFoodPreferences.map((row) => row.workosUserId),
		...source.userFoodDisplayPreferences.map((row) => row.workosUserId),
		...source.userUnitDisplayPreferences.map((row) => row.workosUserId)
	];
	for (const owner of owners) {
		if (exporters.has(owner)) continue;
		exporters.set(
			owner,
			cached.get(owner) ?? { workosUserId: owner, displayName: owner, profilePictureUrl: null }
		);
	}
	const createdAt = recovery.createdAt as `${string}Z`;
	const archives = await Promise.all(
		[...exporters.values()].map(async (exporter) => ({
			workosUserId: exporter.workosUserId,
			displayName: exporter.displayName,
			blob: await createPortableArchiveBlob(
				buildPortableArchive(
					closeRecoverySource(source, exporter.workosUserId, report) as unknown as PortableSource,
					exporter,
					profiles,
					{ createdAt }
				)
			)
		}))
	);
	return { archives, skipped, repaired, unreadable: recovery.unreadable };
};
