import { uuidv7 } from 'uuidv7';

import { runTrackedLocalCommit } from '$lib/client/local/commit-activity.js';
import type { LocalStoreName, MaalDatabase } from '$lib/client/local/database.js';
import { activeHouseholdKey } from '$lib/client/local/profiles.js';
import { requestLocalSync, type SyncRequestedScope } from '$lib/client/sync/requests.js';
import { PortableArchiveError } from '$lib/domain/contracts/errors.js';
import type { PortableArchive } from '$lib/domain/portability/schema.js';
import {
	HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS,
	type HouseholdSyncEntityDescriptor
} from '$lib/sync/household-entities.js';
import type { HouseholdSyncEntityKind } from '$lib/sync/household-contracts.js';
import {
	USER_SYNC_ENTITY_DESCRIPTORS,
	type UserSyncEntityDescriptor
} from '$lib/sync/user-entities.js';
import type { UserSyncEntityKind } from '$lib/sync/contracts.js';

export type ImportResolution = 'keep-local' | 'replace' | 'import-as-copy';

export interface PortableImportCollision {
	readonly collisionId: string;
	readonly store: PortableImportStore;
	readonly importedId: string;
	readonly localId: string;
	/** Display name of the archived record: a title, name, label, or the food or unit it is about. */
	readonly label: string;
	readonly kind: 'primary-id' | 'natural-key';
	readonly allowedResolutions: readonly ImportResolution[];
}

export type PortableImportStore = Exclude<
	LocalStoreName,
	| 'meta'
	| 'profiles'
	| 'authSlots'
	| 'householdInvites'
	| 'billingCapabilities'
	| 'mcpKeySummaries'
	| 'outbox'
	| 'syncScopes'
	| 'backfillCheckpoints'
	| 'uiState'
>;

export interface PortableImportPlan {
	readonly profileId: string;
	readonly importerWorkosUserId: string;
	readonly archiveCreatedAt: string;
	readonly collisions: readonly PortableImportCollision[];
	readonly unresolvedCollisionIds: readonly string[];
	readonly warnings: readonly string[];
	readonly writes: ReadonlyMap<PortableImportStore, readonly Record<string, unknown>[]>;
	/** IDs of written rows that overwrite a local row because the user chose `replace`. */
	readonly replacements: ReadonlyMap<PortableImportStore, ReadonlySet<string>>;
	readonly summary: Readonly<Record<string, number>>;
}

/**
 * Applies one choice to every collision that allows it. Collisions that cannot take the choice,
 * such as a same-name match offered `import-as-copy`, keep no resolution and stay unresolved.
 */
export const bulkResolutions = (
	collisions: readonly PortableImportCollision[],
	resolution: ImportResolution
): Record<string, ImportResolution> =>
	Object.fromEntries(
		collisions
			.filter(({ allowedResolutions }) => allowedResolutions.includes(resolution))
			.map(({ collisionId }) => [collisionId, resolution])
	);

const archiveError = (
	code: PortableArchiveError['code'],
	operation: string,
	message: string
): PortableArchiveError => new PortableArchiveError({ code, operation, message });

const asRecord = (value: object): Record<string, unknown> => value as Record<string, unknown>;
const copyRecord = (value: object): Record<string, unknown> => structuredClone(asRecord(value));
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const rowId = (store: PortableImportStore, row: Record<string, unknown>): string =>
	store === 'households'
		? text(row.householdId)
		: store === 'userAttributions'
			? text(row.workosUserId)
			: text(row.id);

const portableValue = (value: unknown): unknown => {
	if (Array.isArray(value)) {
		const items = value.map(portableValue);
		if (items.every((item) => typeof item === 'string')) return items.toSorted();
		if (
			items.every(
				(item) =>
					typeof item === 'object' &&
					item !== null &&
					typeof (item as Record<string, unknown>).id === 'string'
			)
		) {
			return items.toSorted((left, right) =>
				text((left as Record<string, unknown>).id).localeCompare(
					text((right as Record<string, unknown>).id)
				)
			);
		}
		return items;
	}
	if (typeof value !== 'object' || value === null) return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(
				([key]) => !['conflictClocks', 'revision', 'schemaVersion', 'searchTokens'].includes(key)
			)
			.toSorted(([left], [right]) => left.localeCompare(right))
			.map(([key, field]) => [key, portableValue(field)])
	);
};

export const portableRecordsEqual = (left: unknown, right: unknown): boolean =>
	JSON.stringify(portableValue(left)) === JSON.stringify(portableValue(right));

const mapId = (mapping: ReadonlyMap<string, string>, value: unknown): unknown =>
	typeof value === 'string' ? (mapping.get(value) ?? value) : value;

const remapChildCollection = (
	row: Record<string, unknown>,
	field: string,
	copyRoot: boolean,
	referenceField?: string
): void => {
	const children = row[field];
	if (!Array.isArray(children)) return;
	const childIds = new Map<string, string>();
	if (copyRoot) {
		for (const child of children) {
			if (typeof child !== 'object' || child === null) continue;
			const id = text((child as Record<string, unknown>).id);
			if (id) childIds.set(id, uuidv7());
		}
	}
	row[field] = children.map((child) => {
		if (typeof child !== 'object' || child === null) return child;
		const next = { ...(child as Record<string, unknown>) };
		if (copyRoot && typeof next.id === 'string') next.id = childIds.get(next.id) ?? uuidv7();
		if (referenceField && typeof next[referenceField] === 'string') {
			next[referenceField] = childIds.get(text(next[referenceField])) ?? next[referenceField];
		}
		return next;
	});
};

/**
 * A user recipe is not part of any household copy, so its `savedFromHouseholdId` keeps the original
 * household when the importer knows it and is cleared otherwise. It never points at a local-only
 * copy, because the recipe syncs in the user scope and the server has never seen that household.
 */
const remapRecipe = (
	input: object,
	id: string,
	ownerUserId: string,
	knownHouseholdIds: ReadonlySet<string>,
	taxonomyIds: ReadonlyMap<string, string>,
	copyRoot: boolean
): Record<string, unknown> => {
	const row = copyRecord(input);
	row.id = id;
	row.ownerUserId = ownerUserId;
	if (!knownHouseholdIds.has(text(row.savedFromHouseholdId))) row.savedFromHouseholdId = null;
	for (const field of [
		'ingredients',
		'instructions',
		'applianceRequirements',
		'classifications',
		'media',
		'nutritionFacts'
	]) {
		remapChildCollection(row, field, copyRoot);
	}
	const instructionIds = new Map<string, string>();
	if (copyRoot && Array.isArray(row.instructions)) {
		const original = (asRecord(input).instructions as object[]) ?? [];
		for (let index = 0; index < original.length; index += 1) {
			instructionIds.set(
				text(asRecord(original[index]).id),
				text(asRecord((row.instructions as object[])[index]).id)
			);
		}
	}
	if (Array.isArray(row.instructionEvents)) {
		row.instructionEvents = row.instructionEvents.map((event) => {
			const next = copyRecord(event as object);
			if (copyRoot) next.id = uuidv7();
			next.recipeInstructionId = mapId(instructionIds, next.recipeInstructionId);
			next.unitId = mapId(taxonomyIds, next.unitId);
			next.baseUnitId = mapId(taxonomyIds, next.baseUnitId);
			return next;
		});
	}
	if (Array.isArray(row.ingredients)) {
		row.ingredients = row.ingredients.map((ingredient) => ({
			...asRecord(ingredient as object),
			baseFoodId: mapId(taxonomyIds, asRecord(ingredient as object).baseFoodId),
			baseUnitId: mapId(taxonomyIds, asRecord(ingredient as object).baseUnitId),
			baseUnitFamilyId: mapId(taxonomyIds, asRecord(ingredient as object).baseUnitFamilyId)
		}));
	}
	if (Array.isArray(row.nutritionFacts)) {
		row.nutritionFacts = row.nutritionFacts.map((fact) => ({
			...asRecord(fact as object),
			unitId: mapId(taxonomyIds, asRecord(fact as object).unitId),
			baseUnitId: mapId(taxonomyIds, asRecord(fact as object).baseUnitId)
		}));
	}
	return row;
};

const remapMeal = (
	input: object,
	id: string,
	householdId: string,
	recipeIds: ReadonlyMap<string, string>,
	taxonomyIds: ReadonlyMap<string, string>,
	copyRoot: boolean
): Record<string, unknown> => {
	const row = copyRecord(input);
	row.id = id;
	row.householdId = householdId;
	row.sourceRecipeId = mapId(recipeIds, row.sourceRecipeId);
	for (const field of [
		'ingredients',
		'instructions',
		'applianceRequirements',
		'classifications',
		'media',
		'nutritionFacts'
	]) {
		remapChildCollection(row, field, copyRoot);
	}
	const instructionIds = new Map<string, string>();
	if (copyRoot && Array.isArray(row.instructions)) {
		const original = (asRecord(input).instructions as object[]) ?? [];
		for (let index = 0; index < original.length; index += 1) {
			instructionIds.set(
				text(asRecord(original[index]).id),
				text(asRecord((row.instructions as object[])[index]).id)
			);
		}
	}
	if (Array.isArray(row.instructionEvents)) {
		row.instructionEvents = row.instructionEvents.map((event) => {
			const next = copyRecord(event as object);
			if (copyRoot) next.id = uuidv7();
			next.mealInstructionId = mapId(instructionIds, next.mealInstructionId);
			next.unitId = mapId(taxonomyIds, next.unitId);
			next.baseUnitId = mapId(taxonomyIds, next.baseUnitId);
			return next;
		});
	}
	if (Array.isArray(row.ingredients)) {
		row.ingredients = row.ingredients.map((ingredient) => ({
			...asRecord(ingredient as object),
			baseFoodId: mapId(taxonomyIds, asRecord(ingredient as object).baseFoodId),
			baseUnitId: mapId(taxonomyIds, asRecord(ingredient as object).baseUnitId),
			baseUnitFamilyId: mapId(taxonomyIds, asRecord(ingredient as object).baseUnitFamilyId)
		}));
	}
	if (Array.isArray(row.nutritionFacts)) {
		row.nutritionFacts = row.nutritionFacts.map((fact) => ({
			...asRecord(fact as object),
			unitId: mapId(taxonomyIds, asRecord(fact as object).unitId),
			baseUnitId: mapId(taxonomyIds, asRecord(fact as object).baseUnitId)
		}));
	}
	return row;
};

const naturalKey = (store: PortableImportStore, row: Record<string, unknown>): string | null => {
	const lower = (value: unknown): string => text(value).trim().toLocaleLowerCase('en-US');
	switch (store) {
		case 'householdAppliances':
			return `${text(row.householdId)}\u0000${text(row.appliance)}`;
		case 'foodUserEntries':
		case 'unitUserEntries':
			return `${text(row.workosUserId)}\u0000${lower(row.canonicalLabel)}`;
		case 'foodHouseholdEntries':
		case 'unitHouseholdEntries':
			return `${text(row.householdId)}\u0000${lower(row.canonicalLabel)}`;
		case 'foodUserAliases':
			return `${text(row.workosUserId)}\u0000${text(row.foodId)}\u0000${text(row.locale)}\u0000${lower(row.alias)}`;
		case 'foodHouseholdAliases':
			return `${text(row.householdId)}\u0000${text(row.foodId)}\u0000${text(row.locale)}\u0000${lower(row.alias)}`;
		case 'unitUserAliases':
			return `${text(row.workosUserId)}\u0000${text(row.baseUnitId)}\u0000${text(row.locale)}\u0000${lower(row.alias)}`;
		case 'unitHouseholdAliases':
			return `${text(row.householdId)}\u0000${text(row.baseUnitId)}\u0000${text(row.locale)}\u0000${lower(row.alias)}`;
		case 'userFoodPreferences':
			return `${text(row.workosUserId)}\u0000${text(row.foodId)}`;
		case 'userFoodDisplayPreferences':
			return `${text(row.workosUserId)}\u0000${text(row.foodId)}\u0000${text(row.locale)}`;
		case 'householdFoodDisplayPreferences':
			return `${text(row.householdId)}\u0000${text(row.foodId)}\u0000${text(row.locale)}`;
		case 'userUnitDisplayPreferences':
			return `${text(row.workosUserId)}\u0000${text(row.baseUnitId)}\u0000${text(row.locale)}`;
		case 'householdUnitDisplayPreferences':
			return `${text(row.householdId)}\u0000${text(row.baseUnitId)}\u0000${text(row.locale)}`;
		case 'mealCheckIns':
			return row.mealId === null ? null : `${text(row.mealId)}\u0000${text(row.reporterUserId)}`;
		default:
			return null;
	}
};

const remapTaxonomyRow = (
	input: object,
	store: PortableImportStore,
	importerWorkosUserId: string,
	exporterWorkosUserId: string,
	householdIds: ReadonlyMap<string, string>,
	taxonomyIds: ReadonlyMap<string, string>,
	newId: string
): Record<string, unknown> => {
	const row = copyRecord(input);
	row.id = newId;
	if (row.workosUserId === exporterWorkosUserId) row.workosUserId = importerWorkosUserId;
	row.householdId = mapId(householdIds, row.householdId);
	for (const field of [
		'foodId',
		'unitId',
		'baseUnitId',
		'defaultMeasureUnitId',
		'defaultMeasureBaseUnitId',
		'preferredMeasureUnitId',
		'preferredMeasureBaseUnitId',
		'preferredFoodAliasId',
		'preferredUnitAliasId',
		'preferredUnitId'
	]) {
		row[field] = mapId(taxonomyIds, row[field]);
	}
	return row;
};

interface PlannerState {
	readonly writes: Map<PortableImportStore, Record<string, unknown>[]>;
	readonly replacements: Map<PortableImportStore, Set<string>>;
	readonly collisions: PortableImportCollision[];
	readonly unresolved: string[];
	readonly resolutions: Readonly<Record<string, ImportResolution>>;
	/** Display names by archive ID, for labelling records that only reference a food, unit, or meal. */
	readonly names: ReadonlyMap<string, string>;
}

const archiveNames = (archive: PortableArchive): Map<string, string> => {
	const names = new Map<string, string>();
	const { taxonomy } = archive;
	for (const alias of [...taxonomy.foodAliases, ...taxonomy.unitAliases]) {
		const targetId = 'foodId' in alias ? alias.foodId : alias.unitId;
		if (alias.defaultForLocale || !names.has(targetId)) names.set(targetId, alias.alias);
	}
	for (const alias of [...taxonomy.foodUserAliases, ...taxonomy.foodHouseholdAliases]) {
		if (!names.has(alias.foodId)) names.set(alias.foodId, alias.alias);
	}
	for (const entry of [
		...taxonomy.foodUserEntries,
		...taxonomy.foodHouseholdEntries,
		...taxonomy.unitUserEntries,
		...taxonomy.unitHouseholdEntries
	]) {
		names.set(entry.id, entry.canonicalLabel);
	}
	for (const meal of archive.meals.meals) names.set(meal.id, meal.title);
	return names;
};

const recordLabel = (
	store: PortableImportStore,
	row: Record<string, unknown>,
	names: ReadonlyMap<string, string>
): string => {
	const own = row.title ?? row.name ?? row.canonicalLabel ?? row.alias ?? row.appliance;
	if (typeof own === 'string') {
		return store === 'meals' && typeof row.date === 'string' ? `${own} · ${row.date}` : own;
	}
	return names.get(text(row.foodId ?? row.baseUnitId ?? row.mealId)) ?? '';
};

const addWrite = (
	state: PlannerState,
	store: PortableImportStore,
	row: Record<string, unknown>
): void => {
	const rows = state.writes.get(store) ?? [];
	rows.push(row);
	state.writes.set(store, rows);
};

const resolveCandidate = async (
	database: MaalDatabase,
	state: PlannerState,
	store: PortableImportStore,
	row: Record<string, unknown>,
	allowCopy: boolean
): Promise<{ action: 'write' | 'skip'; id: string; copied: boolean }> => {
	const importedId = rowId(store, row);
	const table = database.table(store);
	const localById = importedId ? await table.get(importedId) : undefined;
	let local = localById as Record<string, unknown> | undefined;
	let kind: PortableImportCollision['kind'] = 'primary-id';
	if (!local) {
		const key = naturalKey(store, row);
		if (key) {
			local = (await table.filter((candidate) => naturalKey(store, candidate) === key).first()) as
				Record<string, unknown> | undefined;
			if (local) kind = 'natural-key';
		}
	}
	if (!local) return { action: 'write', id: importedId, copied: false };
	const localId = rowId(store, local);
	// A same-name match only differs by ID, so compare it as if it already had the local ID.
	if (portableRecordsEqual(local, kind === 'natural-key' ? { ...row, id: localId } : row))
		return { action: 'skip', id: localId, copied: false };

	const collisionId = `${store}:${kind}:${naturalKey(store, row) ?? importedId}:${localId}`;
	const allowedResolutions: readonly ImportResolution[] =
		allowCopy && kind === 'primary-id'
			? ['keep-local', 'replace', 'import-as-copy']
			: ['keep-local', 'replace'];
	state.collisions.push({
		collisionId,
		store,
		importedId,
		localId,
		label: recordLabel(store, row, state.names),
		kind,
		allowedResolutions
	});
	const resolution = state.resolutions[collisionId];
	if (!resolution || !allowedResolutions.includes(resolution)) {
		state.unresolved.push(collisionId);
		return { action: 'skip', id: localId, copied: false };
	}
	if (resolution === 'keep-local') return { action: 'skip', id: localId, copied: false };
	if (resolution === 'import-as-copy') return { action: 'write', id: uuidv7(), copied: true };
	// Replace writes the archived content under the local ID. D1 allows one row per natural key, so
	// a delete plus an insert under a new ID could reach the server in the wrong order.
	const replaced = state.replacements.get(store) ?? new Set<string>();
	replaced.add(localId);
	state.replacements.set(store, replaced);
	return { action: 'write', id: localId, copied: false };
};

const taxonomyStores = [
	'units',
	'unitUserEntries',
	'unitHouseholdEntries',
	'foods',
	'foodUserEntries',
	'foodHouseholdEntries',
	'unitAliases',
	'unitUserAliases',
	'unitHouseholdAliases',
	'foodAliases',
	'foodUserAliases',
	'foodHouseholdAliases'
] as const satisfies readonly PortableImportStore[];

const globalTaxonomyStores = new Set<PortableImportStore>([
	'units',
	'unitAliases',
	'foods',
	'foodAliases'
]);

const preferenceStores = [
	'userFoodPreferences',
	'userFoodDisplayPreferences',
	'householdFoodDisplayPreferences',
	'userUnitDisplayPreferences',
	'householdUnitDisplayPreferences'
] as const satisfies readonly PortableImportStore[];

const archiveRowsForStore = (
	archive: PortableArchive,
	store: (typeof taxonomyStores)[number] | (typeof preferenceStores)[number]
): readonly object[] => {
	if (store in archive.taxonomy) return asRecord(archive.taxonomy)[store] as object[];
	return asRecord(archive.preferences)[store] as object[];
};

const localForkMembership = (
	householdId: string,
	workosUserId: string,
	createdAt: string
): Record<string, unknown> => ({
	membershipId: uuidv7(),
	householdId,
	workosUserId,
	roleSlug: 'admin',
	permissions: ['households:write', 'recipes:read', 'recipes:write', 'meals:read', 'meals:write'],
	status: 'active',
	directoryManaged: false,
	workosCreatedAt: createdAt,
	lastVerifiedAt: createdAt,
	updatedAt: createdAt,
	detachedAt: null,
	denialCode: null,
	source: 'localFork'
});

const validatePlannedUniqueness = (state: PlannerState): void => {
	for (const [store, rows] of state.writes) {
		const ids = new Set<string>();
		const naturalKeys = new Set<string>();
		for (const row of rows) {
			const id = rowId(store, row);
			if (id && ids.has(id)) {
				throw archiveError(
					'invalid_content',
					'validate archive import plan',
					`The archive repeats an identity in ${store}.`
				);
			}
			if (id) ids.add(id);
			const key = naturalKey(store, row);
			if (key && naturalKeys.has(key)) {
				throw archiveError(
					'invalid_content',
					'validate archive import plan',
					`The archive repeats a semantic key in ${store}.`
				);
			}
			if (key) naturalKeys.add(key);
		}
	}
};

const validatePlannedReferences = async (
	database: MaalDatabase,
	state: PlannerState
): Promise<void> => {
	const idsFor = async (...stores: PortableImportStore[]): Promise<Set<string>> => {
		const ids = new Set<string>();
		for (const store of stores) {
			for (const key of await database.table(store).toCollection().primaryKeys()) {
				if (typeof key === 'string') ids.add(key);
			}
			for (const row of state.writes.get(store) ?? []) ids.add(rowId(store, row));
		}
		return ids;
	};
	const [householdIds, mealIds, foodIds, unitIds, foodAliasIds, unitAliasIds] = await Promise.all([
		idsFor('households'),
		idsFor('meals'),
		idsFor('foods', 'foodUserEntries', 'foodHouseholdEntries'),
		idsFor('units', 'unitUserEntries', 'unitHouseholdEntries'),
		idsFor('foodAliases', 'foodUserAliases', 'foodHouseholdAliases'),
		idsFor('unitAliases', 'unitUserAliases', 'unitHouseholdAliases')
	]);
	const requireReference = (
		value: unknown,
		available: ReadonlySet<string>,
		label: string
	): void => {
		if (value === null || value === undefined) return;
		if (typeof value !== 'string' || !available.has(value)) {
			throw archiveError(
				'invalid_content',
				'validate archive references',
				`The archive has an unresolved ${label} reference.`
			);
		}
	};
	for (const row of state.writes.get('householdAppliances') ?? []) {
		requireReference(row.householdId, householdIds, 'household appliance');
	}
	for (const store of ['foodUserAliases', 'foodHouseholdAliases'] as const) {
		for (const row of state.writes.get(store) ?? []) {
			requireReference(row.foodId, foodIds, 'food alias');
			requireReference(row.defaultMeasureUnitId, unitIds, 'food alias unit');
			requireReference(row.defaultMeasureBaseUnitId, unitIds, 'food alias base unit');
		}
	}
	for (const store of ['unitUserAliases', 'unitHouseholdAliases'] as const) {
		for (const row of state.writes.get(store) ?? []) {
			requireReference(row.unitId, unitIds, 'unit alias');
			requireReference(row.baseUnitId, unitIds, 'unit alias base');
		}
	}
	for (const store of ['foodUserEntries', 'foodHouseholdEntries'] as const) {
		for (const row of state.writes.get(store) ?? []) {
			requireReference(row.defaultMeasureUnitId, unitIds, 'food entry unit');
			requireReference(row.defaultMeasureBaseUnitId, unitIds, 'food entry base unit');
		}
	}
	for (const store of ['unitUserEntries', 'unitHouseholdEntries'] as const) {
		for (const row of state.writes.get(store) ?? []) {
			requireReference(row.baseUnitId, unitIds, 'unit entry base');
		}
	}
	for (const row of state.writes.get('recipes') ?? []) {
		requireReference(row.savedFromHouseholdId, householdIds, 'saved recipe household');
		for (const ingredient of (row.ingredients as Record<string, unknown>[] | undefined) ?? []) {
			requireReference(ingredient.baseFoodId, foodIds, 'recipe food');
			requireReference(ingredient.baseUnitId, unitIds, 'recipe unit');
			requireReference(ingredient.baseUnitFamilyId, unitIds, 'recipe unit family');
		}
	}
	// Meal provenance may name another member's recipe, which syncs only to its owner, so it is
	// not required to resolve on this device.
	for (const row of state.writes.get('meals') ?? []) {
		requireReference(row.householdId, householdIds, 'meal household');
		for (const ingredient of (row.ingredients as Record<string, unknown>[] | undefined) ?? []) {
			requireReference(ingredient.baseFoodId, foodIds, 'meal food');
			requireReference(ingredient.baseUnitId, unitIds, 'meal unit');
			requireReference(ingredient.baseUnitFamilyId, unitIds, 'meal unit family');
		}
	}
	for (const row of state.writes.get('mealCheckIns') ?? []) {
		requireReference(row.mealId, mealIds, 'check-in meal');
	}
	for (const row of state.writes.get('userFoodPreferences') ?? []) {
		requireReference(row.foodId, foodIds, 'food preference');
	}
	for (const store of ['userFoodDisplayPreferences', 'householdFoodDisplayPreferences'] as const) {
		for (const row of state.writes.get(store) ?? []) {
			requireReference(row.foodId, foodIds, 'food display preference');
			requireReference(row.preferredFoodAliasId, foodAliasIds, 'food display alias');
			requireReference(row.preferredMeasureUnitId, unitIds, 'food display unit');
			requireReference(row.preferredMeasureBaseUnitId, unitIds, 'food display base unit');
		}
	}
	for (const store of ['userUnitDisplayPreferences', 'householdUnitDisplayPreferences'] as const) {
		for (const row of state.writes.get(store) ?? []) {
			requireReference(row.baseUnitId, unitIds, 'unit display base');
			requireReference(row.preferredUnitId, unitIds, 'unit display preference');
			requireReference(row.preferredUnitAliasId, unitAliasIds, 'unit display alias');
		}
	}
};

export const planPortableImport = async (
	database: MaalDatabase,
	archive: PortableArchive,
	profileId: string,
	resolutions: Readonly<Record<string, ImportResolution>> = {}
): Promise<PortableImportPlan> => {
	const profile = await database.profiles.get(profileId);
	if (!profile)
		throw archiveError(
			'invalid_content',
			'plan archive import',
			'The importing profile is missing.'
		);
	const activeMemberships = await database.memberships
		.where('workosUserId')
		.equals(profile.workosUserId)
		.filter(({ status }) => status === 'active')
		.toArray();
	const activeHouseholdIds = new Set(activeMemberships.map(({ householdId }) => householdId));
	const state: PlannerState = {
		writes: new Map(),
		replacements: new Map(),
		collisions: [],
		unresolved: [],
		resolutions,
		names: archiveNames(archive)
	};
	const warnings: string[] = [];
	const householdIds = new Map<string, string>();
	const taxonomyIds = new Map<string, string>();
	const recipeIds = new Map<string, string>();
	const mealIds = new Map<string, string>();

	for (const archived of archive.households.households) {
		const originalId = archived.householdId;
		if (!activeHouseholdIds.has(originalId)) {
			const id = uuidv7();
			householdIds.set(originalId, id);
			addWrite(state, 'households', {
				...copyRecord(archived),
				householdId: id,
				createdByUserId: profile.workosUserId,
				localOnly: true,
				deletionState: 'active',
				deletedAt: null
			});
			addWrite(
				state,
				'memberships',
				localForkMembership(id, profile.workosUserId, archive.manifest.createdAt)
			);
			warnings.push(`Household ${originalId} will be restored as a local-only copy.`);
			continue;
		}
		const candidate = copyRecord(archived);
		const decision = await resolveCandidate(database, state, 'households', candidate, true);
		const id = decision.copied ? decision.id : originalId;
		householdIds.set(originalId, id);
		if (decision.action === 'write') {
			candidate.householdId = id;
			if (decision.copied) {
				candidate.localOnly = true;
				candidate.createdByUserId = profile.workosUserId;
				candidate.deletionState = 'active';
				candidate.deletedAt = null;
				addWrite(
					state,
					'memberships',
					localForkMembership(id, profile.workosUserId, archive.manifest.createdAt)
				);
			}
			addWrite(state, 'households', candidate);
		}
	}
	const knownHouseholdIds = new Set([
		...(await database.households.toCollection().primaryKeys()),
		...[...householdIds].flatMap(([original, mapped]) => (original === mapped ? [original] : []))
	]);

	for (const store of taxonomyStores) {
		for (const archived of archiveRowsForStore(archive, store)) {
			const original = copyRecord(archived);
			const originalId = text(original.id);
			if (globalTaxonomyStores.has(store)) {
				taxonomyIds.set(originalId, originalId);
				continue;
			}
			const ownerChanged =
				original.workosUserId === archive.manifest.exporterWorkosUserId &&
				archive.manifest.exporterWorkosUserId !== profile.workosUserId;
			const householdChanged =
				typeof original.householdId === 'string' &&
				householdIds.get(original.householdId) !== original.householdId;
			const initialId = ownerChanged || householdChanged ? uuidv7() : originalId;
			taxonomyIds.set(originalId, initialId);
			const candidate = remapTaxonomyRow(
				archived,
				store,
				profile.workosUserId,
				archive.manifest.exporterWorkosUserId,
				householdIds,
				taxonomyIds,
				initialId
			);
			const decision = await resolveCandidate(database, state, store, candidate, false);
			taxonomyIds.set(originalId, decision.id);
			candidate.id = decision.id;
			if (decision.action === 'write') addWrite(state, store, candidate);
		}
	}

	const allRecipes = [...archive.recipes.recipes, ...(archive.deletedRecipes?.recipes ?? [])];
	for (const archived of allRecipes) {
		const ownerChanged = archived.ownerUserId !== profile.workosUserId;
		const preliminaryId = ownerChanged ? uuidv7() : archived.id;
		let candidate = remapRecipe(
			archived,
			preliminaryId,
			profile.workosUserId,
			knownHouseholdIds,
			taxonomyIds,
			ownerChanged
		);
		const decision = await resolveCandidate(database, state, 'recipes', candidate, true);
		const finalId = decision.id;
		recipeIds.set(archived.id, finalId);
		if (decision.action === 'write') {
			candidate = remapRecipe(
				archived,
				finalId,
				profile.workosUserId,
				knownHouseholdIds,
				taxonomyIds,
				ownerChanged || decision.copied
			);
			addWrite(state, 'recipes', candidate);
		}
	}

	for (const archived of archive.meals.meals) {
		const householdId = householdIds.get(archived.householdId) ?? archived.householdId;
		const householdChanged = householdId !== archived.householdId;
		const preliminaryId = householdChanged ? uuidv7() : archived.id;
		let candidate = remapMeal(
			archived,
			preliminaryId,
			householdId,
			recipeIds,
			taxonomyIds,
			householdChanged
		);
		const decision = await resolveCandidate(database, state, 'meals', candidate, true);
		mealIds.set(archived.id, decision.id);
		if (decision.action === 'write') {
			candidate = remapMeal(
				archived,
				decision.id,
				householdId,
				recipeIds,
				taxonomyIds,
				householdChanged || decision.copied
			);
			addWrite(state, 'meals', candidate);
		}
	}

	for (const archived of archive.households.appliances) {
		const householdId = householdIds.get(archived.householdId) ?? archived.householdId;
		const candidate = {
			...copyRecord(archived),
			id: householdId === archived.householdId ? archived.id : uuidv7(),
			householdId
		};
		const decision = await resolveCandidate(
			database,
			state,
			'householdAppliances',
			candidate,
			false
		);
		candidate.id = decision.id;
		if (decision.action === 'write') addWrite(state, 'householdAppliances', candidate);
	}

	for (const archived of archive.checkIns.checkIns) {
		const mappedMealId =
			archived.mealId === null ? null : (mealIds.get(archived.mealId) ?? archived.mealId);
		const mealChanged = mappedMealId !== archived.mealId;
		const candidate = {
			...copyRecord(archived),
			id: mealChanged ? uuidv7() : archived.id,
			mealId: mappedMealId
		};
		const decision = await resolveCandidate(database, state, 'mealCheckIns', candidate, true);
		candidate.id = decision.id;
		if (decision.action === 'write') addWrite(state, 'mealCheckIns', candidate);
	}

	for (const store of preferenceStores) {
		for (const archived of archiveRowsForStore(archive, store)) {
			const original = copyRecord(archived);
			const ownerChanged =
				original.workosUserId === archive.manifest.exporterWorkosUserId &&
				archive.manifest.exporterWorkosUserId !== profile.workosUserId;
			const householdChanged =
				typeof original.householdId === 'string' &&
				householdIds.get(original.householdId) !== original.householdId;
			const id = ownerChanged || householdChanged ? uuidv7() : text(original.id);
			const candidate = remapTaxonomyRow(
				archived,
				store,
				profile.workosUserId,
				archive.manifest.exporterWorkosUserId,
				householdIds,
				taxonomyIds,
				id
			);
			const decision = await resolveCandidate(database, state, store, candidate, false);
			candidate.id = decision.id;
			if (decision.action === 'write') addWrite(state, store, candidate);
		}
	}

	for (const user of archive.users.users) addWrite(state, 'userAttributions', copyRecord(user));
	validatePlannedUniqueness(state);
	await validatePlannedReferences(database, state);

	const summary = Object.fromEntries(
		[...state.writes.entries()].map(([store, rows]) => [store, rows.length])
	);
	return {
		profileId,
		importerWorkosUserId: profile.workosUserId,
		archiveCreatedAt: archive.manifest.createdAt,
		collisions: state.collisions,
		unresolvedCollisionIds: state.unresolved,
		warnings,
		writes: state.writes,
		replacements: state.replacements,
		summary
	};
};

type PortableSyncDescriptor = {
	readonly entityKind: UserSyncEntityKind | HouseholdSyncEntityKind;
	readonly scopeKind: 'user' | 'household';
	readonly store: PortableImportStore;
	readonly conflictGroups: readonly string[];
};

const portableSyncDescriptors: readonly PortableSyncDescriptor[] = [
	...(
		Object.entries(USER_SYNC_ENTITY_DESCRIPTORS) as [UserSyncEntityKind, UserSyncEntityDescriptor][]
	).map(([entityKind, descriptor]) => ({
		entityKind,
		scopeKind: 'user' as const,
		store: descriptor.store as PortableImportStore,
		conflictGroups: descriptor.conflictGroups
	})),
	...(
		Object.entries(HOUSEHOLD_SYNC_ENTITY_DESCRIPTORS) as [
			HouseholdSyncEntityKind,
			HouseholdSyncEntityDescriptor
		][]
	).map(([entityKind, descriptor]) => ({
		entityKind,
		scopeKind: 'household' as const,
		store: descriptor.store as PortableImportStore,
		conflictGroups: descriptor.conflictGroups
	}))
];

const descriptorByStore = new Map(
	portableSyncDescriptors.map((descriptor) => [descriptor.store, descriptor])
);

const syncScopeKey = (scope: SyncRequestedScope): string =>
	`${scope.scopeKind}\u0000${scope.scopeId}`;

/**
 * New rows retain archive event times for backfill. Explicit replacements are new local intent,
 * so their clocks use the import time while content timestamps remain unchanged for re-imports.
 */
const importedAggregate = (
	descriptor: PortableSyncDescriptor,
	record: Record<string, unknown>,
	originDeviceId: string,
	mutationId: string,
	occurredAt: string = text(record.updatedAt)
): Record<string, unknown> => {
	const clock = { occurredAt, originDeviceId, mutationId };
	return {
		...record,
		schemaVersion: 1,
		conflictClocks: Object.fromEntries(descriptor.conflictGroups.map((group) => [group, clock]))
	};
};

export const commitPortableImport = async (
	database: MaalDatabase,
	plan: PortableImportPlan
): Promise<void> => {
	if (plan.unresolvedCollisionIds.length > 0) {
		throw archiveError(
			'unresolved_collision',
			'commit archive import',
			'Choose what to do with every collision before importing.'
		);
	}
	const device = await database.meta.get('deviceId');
	const originDeviceId = text(device?.value);
	if (!originDeviceId) {
		throw archiveError(
			'commit_failed',
			'commit archive import',
			'The local device identity is missing.'
		);
	}
	const importedAt = new Date().toISOString() as `${string}Z`;
	const slot = await database.authSlots.where('profileId').equals(plan.profileId).first();
	const authSlotId = slot?.authSlotId ?? `signed-out:${plan.profileId}`;
	const requestedScopes = new Map<string, SyncRequestedScope>();
	try {
		await runTrackedLocalCommit(database.name, 'commit archive import', () =>
			database.transaction('rw', database.tables, async () => {
				for (const [store, rows] of plan.writes) {
					const descriptor = descriptorByStore.get(store);
					if (!descriptor) {
						await database.table(store).bulkPut([...rows]);
						continue;
					}
					const replaced = plan.replacements.get(store);
					const prepared = rows.map((row) => ({
						row,
						mutationId: uuidv7(),
						replacement:
							replaced?.has(rowId(store, row)) &&
							(descriptor.entityKind !== 'meal_check_in' ||
								row.reporterUserId === plan.importerWorkosUserId)
					}));
					await database
						.table(store)
						.bulkPut(
							prepared.map(({ row, mutationId, replacement }) =>
								importedAggregate(
									descriptor,
									row,
									originDeviceId,
									mutationId,
									replacement ? importedAt : text(row.updatedAt)
								)
							)
						);
					for (const { row, mutationId, replacement } of prepared) {
						const id = rowId(store, row);
						const scopeId =
							descriptor.scopeKind === 'user'
								? plan.importerWorkosUserId
								: descriptor.entityKind === 'meal_check_in'
									? ((await database.meals.get(text(row.mealId)))?.householdId ?? '')
									: text(row.householdId);
						if (!scopeId) continue;
						if (
							descriptor.scopeKind === 'household' &&
							(await database.households.get(scopeId))?.localOnly
						) {
							continue;
						}
						// Backfill handles historical rows. Only the reporter may push a check-in;
						// other reporters' imported projections remain subject to authoritative pulls.
						if (replacement) {
							await database.outbox
								.where('aggregateId')
								.equals(id)
								.filter(
									(intent) =>
										intent.scopeKind === descriptor.scopeKind &&
										intent.scopeId === scopeId &&
										intent.entityKind === descriptor.entityKind &&
										['pending', 'sending', 'quarantined'].includes(intent.status)
								)
								.delete();
							await database.outbox.add({
								mutationId,
								authSlotId,
								scopeKind: descriptor.scopeKind,
								scopeId,
								status: 'pending',
								occurredAt: importedAt,
								aggregateId: id,
								entityKind: descriptor.entityKind,
								conflictGroup: descriptor.conflictGroups[0]!,
								operation: row.deletedAt === null ? 'upsert' : 'delete',
								originDeviceId,
								payload: null,
								nextAttemptAt: importedAt,
								attempts: 0
							});
						}
						await database.backfillCheckpoints.delete([
							descriptor.scopeKind,
							scopeId,
							descriptor.entityKind
						]);
						const scope = { scopeKind: descriptor.scopeKind, scopeId };
						requestedScopes.set(syncScopeKey(scope), scope);
					}
				}
				const currentActiveHousehold = await database.uiState.get(
					activeHouseholdKey(plan.profileId)
				);
				if (!currentActiveHousehold) {
					const importedHousehold = plan.writes.get('households')?.[0];
					if (importedHousehold) {
						await database.uiState.put({
							key: activeHouseholdKey(plan.profileId),
							value: importedHousehold.householdId
						});
					}
				}
			})
		);
		if (requestedScopes.size > 0) {
			requestLocalSync({ databaseName: database.name, scopes: [...requestedScopes.values()] });
		}
	} catch (error) {
		if (error instanceof PortableArchiveError) throw error;
		throw archiveError(
			'commit_failed',
			'commit archive import',
			'The archive could not be saved. Existing local data was not changed.'
		);
	}
};
