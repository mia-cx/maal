import { uuidv7 } from 'uuidv7';

import { runTrackedLocalCommit } from '$lib/client/local/commit-activity.js';
import type { LocalStoreName, MaalDatabase } from '$lib/client/local/database.js';
import { activeHouseholdKey } from '$lib/client/local/profiles.js';
import { PortableArchiveError } from '$lib/domain/contracts/errors.js';
import type { PortableArchive } from '$lib/domain/portability/schema.js';

export type ImportResolution = 'keep-local' | 'replace' | 'import-as-copy';

export interface PortableImportCollision {
	readonly collisionId: string;
	readonly store: PortableImportStore;
	readonly importedId: string;
	readonly localId: string;
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
	readonly deletes: ReadonlyMap<PortableImportStore, readonly string[]>;
	readonly summary: Readonly<Record<string, number>>;
}

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

const remapRecipe = (
	input: object,
	id: string,
	ownerUserId: string,
	householdIds: ReadonlyMap<string, string>,
	taxonomyIds: ReadonlyMap<string, string>,
	copyRoot: boolean
): Record<string, unknown> => {
	const row = copyRecord(input);
	row.id = id;
	row.ownerUserId = ownerUserId;
	row.savedFromHouseholdId = mapId(householdIds, row.savedFromHouseholdId);
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
	readonly deletes: Map<PortableImportStore, string[]>;
	readonly collisions: PortableImportCollision[];
	readonly unresolved: string[];
	readonly resolutions: Readonly<Record<string, ImportResolution>>;
}

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
	if (portableRecordsEqual(local, row))
		return { action: 'skip', id: rowId(store, local), copied: false };

	const localId = rowId(store, local);
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
	if (localId !== importedId) {
		const deletes = state.deletes.get(store) ?? [];
		deletes.push(localId);
		state.deletes.set(store, deletes);
	}
	return { action: 'write', id: importedId, copied: false };
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
			const deleted = new Set(state.deletes.get(store) ?? []);
			for (const key of await database.table(store).toCollection().primaryKeys()) {
				if (typeof key === 'string' && !deleted.has(key)) ids.add(key);
			}
			for (const row of state.writes.get(store) ?? []) ids.add(rowId(store, row));
		}
		return ids;
	};
	const [householdIds, recipeIds, mealIds, foodIds, unitIds, foodAliasIds, unitAliasIds] =
		await Promise.all([
			idsFor('households'),
			idsFor('recipes'),
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
	for (const row of state.writes.get('meals') ?? []) {
		requireReference(row.householdId, householdIds, 'meal household');
		requireReference(row.sourceRecipeId, recipeIds, 'meal recipe provenance');
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
		deletes: new Map(),
		collisions: [],
		unresolved: [],
		resolutions
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

	for (const store of taxonomyStores) {
		for (const archived of archiveRowsForStore(archive, store)) {
			const original = copyRecord(archived);
			const originalId = text(original.id);
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
			householdIds,
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
				householdIds,
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
		deletes: state.deletes,
		summary
	};
};

const aggregateStores = new Set<PortableImportStore>([
	'households',
	'householdAppliances',
	'recipes',
	'meals',
	'mealCheckIns',
	'foodUserAliases',
	'foodHouseholdAliases',
	'foodUserEntries',
	'foodHouseholdEntries',
	'unitUserAliases',
	'unitHouseholdAliases',
	'unitUserEntries',
	'unitHouseholdEntries',
	'userFoodPreferences',
	'userFoodDisplayPreferences',
	'householdFoodDisplayPreferences',
	'userUnitDisplayPreferences',
	'householdUnitDisplayPreferences'
]);

const importedAggregate = (
	record: Record<string, unknown>,
	importedAt: `${string}Z`,
	originDeviceId: string
): Record<string, unknown> => ({
	...record,
	schemaVersion: 1,
	revision: 1,
	updatedAt: importedAt,
	conflictClocks: {
		import: { occurredAt: importedAt, originDeviceId, mutationId: uuidv7() }
	}
});

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
	try {
		await runTrackedLocalCommit(database.name, 'commit archive import', () =>
			database.transaction('rw', database.tables, async () => {
				for (const [store, ids] of plan.deletes) await database.table(store).bulkDelete([...ids]);
				for (const [store, rows] of plan.writes) {
					const prepared = aggregateStores.has(store)
						? rows.map((row) => importedAggregate(row, importedAt, originDeviceId))
						: [...rows];
					if (prepared.length > 0) await database.table(store).bulkPut(prepared);
					if (aggregateStores.has(store)) {
						await database.remoteProjectionMeta.bulkPut(
							prepared.map((row) => ({
								key: `portableImport:${store}:${rowId(store, row)}`,
								refreshedAt: null,
								decodeVersion: 1,
								value: { state: 'neverAcknowledged', importedAt }
							}))
						);
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
	} catch (error) {
		if (error instanceof PortableArchiveError) throw error;
		throw archiveError(
			'commit_failed',
			'commit archive import',
			'The archive could not be saved. Existing local data was not changed.'
		);
	}
};
