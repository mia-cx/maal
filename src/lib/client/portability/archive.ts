import {
	BlobReader,
	BlobWriter,
	TextReader,
	TextWriter,
	ZipReader,
	ZipWriter,
	configure,
	type Entry
} from '@zip.js/zip.js';
import type { Table } from 'dexie';
import { Schema } from 'effect';

import type { LocalStoreName, MaalDatabase } from '$lib/client/local/database.js';
import { PortableArchiveError } from '$lib/domain/contracts/errors.js';
import { GLOBAL_TAXONOMY_SEED_VERSION } from '$lib/domain/taxonomy/global-seed.js';
import {
	PORTABLE_ARCHIVE_FORMAT_VERSION,
	PORTABLE_FILE_VERSION,
	PortableCheckInsFileSchema,
	PortableDeletedRecipesFileSchema,
	PortableDetachedHouseholdsFileSchema,
	PortableHouseholdsFileSchema,
	PortableManifestSchema,
	PortableMealsFileSchema,
	PortablePreferencesFileSchema,
	PortableRecipesFileSchema,
	PortableTaxonomyFileSchema,
	PortableUserAttributionSchema,
	PortableUsersFileSchema,
	type PortableArchive
} from '$lib/domain/portability/schema.js';
import { MealCheckInSchema, StoredMealSchema, isMealAggregate } from '$lib/domain/meals/schema.js';
import { StoredRecipeSchema, isRecipeAggregate } from '$lib/domain/recipes/schema.js';

configure({ useWebWorkers: false });

export const MAX_COMPRESSED_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_UNCOMPRESSED_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_JSON_ENTRY_BYTES = 128 * 1024 * 1024;

export const REQUIRED_PORTABLE_ENTRY_NAMES = [
	'manifest.json',
	'users.json',
	'households.json',
	'recipes.json',
	'meals.json',
	'check-ins.json',
	'taxonomy.json',
	'preferences.json'
] as const;

export const OPTIONAL_PORTABLE_ENTRY_NAMES = [
	'deleted-recipes.json',
	'detached-households.json'
] as const;

export const KNOWN_PORTABLE_ENTRY_NAMES = [
	...REQUIRED_PORTABLE_ENTRY_NAMES,
	...OPTIONAL_PORTABLE_ENTRY_NAMES
] as const;

type PortableEntryName = (typeof KNOWN_PORTABLE_ENTRY_NAMES)[number];
const knownEntryNames = new Set<string>(KNOWN_PORTABLE_ENTRY_NAMES);
const textEncoder = new TextEncoder();

const archiveError = (
	code: PortableArchiveError['code'],
	operation: string,
	message: string
): PortableArchiveError => new PortableArchiveError({ code, operation, message });

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown, operation: string): A => {
	try {
		return Schema.decodeUnknownSync(schema)(value);
	} catch {
		throw archiveError(
			'invalid_content',
			operation,
			`${operation}: the archive content did not match its contract.`
		);
	}
};

const parseJson = (source: string, name: string): unknown => {
	try {
		return JSON.parse(source);
	} catch {
		throw archiveError('invalid_content', `parse ${name}`, `${name} is not valid JSON.`);
	}
};

const jsonText = (value: unknown): string => JSON.stringify(value);

const withoutConflictClocks = <A extends { conflictClocks: unknown }>(
	record: A
): Omit<A, 'conflictClocks'> => {
	const { conflictClocks, ...portable } = record;
	void conflictClocks;
	return portable;
};

const fileCount = (value: unknown): number => {
	if (typeof value !== 'object' || value === null) return 0;
	return Object.values(value).reduce(
		(total, field) => total + (Array.isArray(field) ? field.length : 0),
		0
	);
};

const portableUserRows = <A extends { workosUserId: string; conflictClocks: unknown }>(
	rows: readonly A[],
	workosUserId: string
): Omit<A, 'conflictClocks'>[] =>
	rows.filter((row) => row.workosUserId === workosUserId).map(withoutConflictClocks);

const portableHouseholdRows = <A extends { householdId: string; conflictClocks: unknown }>(
	rows: readonly A[],
	householdIds: ReadonlySet<string>
): Omit<A, 'conflictClocks'>[] =>
	rows.filter((row) => householdIds.has(row.householdId)).map(withoutConflictClocks);

export interface PortableExportOptions {
	readonly appVersion?: string;
	readonly createdAt?: `${string}Z`;
}

/** Local stores an archive is built from. Profiles contribute only their display attribution. */
export const PORTABLE_SOURCE_STORES = [
	'memberships',
	'households',
	'householdAppliances',
	'recipes',
	'meals',
	'mealCheckIns',
	'userAttributions',
	'foods',
	'foodAliases',
	'foodUserAliases',
	'foodHouseholdAliases',
	'foodUserEntries',
	'foodHouseholdEntries',
	'units',
	'unitAliases',
	'unitUserAliases',
	'unitHouseholdAliases',
	'unitUserEntries',
	'unitHouseholdEntries',
	'userFoodPreferences',
	'userFoodDisplayPreferences',
	'householdFoodDisplayPreferences',
	'userUnitDisplayPreferences',
	'householdUnitDisplayPreferences'
] as const satisfies readonly LocalStoreName[];

type PortableSourceStore = (typeof PORTABLE_SOURCE_STORES)[number];
type StoreRow<K extends PortableSourceStore> =
	MaalDatabase[K] extends Table<infer Row, string> ? Row : never;

/** Every row of each source store, as the live database or a recovery read returns them. */
export type PortableSource = { readonly [K in PortableSourceStore]: readonly StoreRow<K>[] };

export type PortableUserAttribution = typeof PortableUserAttributionSchema.Type;

/**
 * Builds the archive of everything `exporter` can see in `source`. `localUsers` are this
 * device's profiles; their attribution wins over cached attributions of the same user.
 */
export const buildPortableArchive = (
	source: PortableSource,
	exporter: PortableUserAttribution,
	localUsers: readonly PortableUserAttribution[],
	options: PortableExportOptions = {}
): PortableArchive => {
	const exporterId = exporter.workosUserId;
	const memberships = source.memberships.filter(
		({ workosUserId, status }) => workosUserId === exporterId && status !== 'revoked'
	);
	const householdIds = new Set(memberships.map(({ householdId }) => householdId));
	const households = source.households
		.filter(
			({ householdId, deletionState }) =>
				householdIds.has(householdId) && deletionState !== 'purged'
		)
		.map(withoutConflictClocks);
	const appliances = portableHouseholdRows(source.householdAppliances, householdIds);
	const recipes = source.recipes
		.filter(({ ownerUserId }) => ownerUserId === exporterId)
		.map((record) => decode(StoredRecipeSchema, record, 'decode recipe for export'))
		.filter(isRecipeAggregate);
	const activeRecipes = recipes
		.filter(({ deletedAt }) => deletedAt === null)
		.map(withoutConflictClocks);
	const deletedRecipes = recipes
		.filter(({ deletedAt }) => deletedAt !== null)
		.map(withoutConflictClocks);
	const meals = source.meals
		.map((record) => decode(StoredMealSchema, record, 'decode meal for export'))
		.filter(isMealAggregate)
		.filter(({ householdId, deletedAt }) => householdIds.has(householdId) && deletedAt === null);
	const mealIds = new Set(meals.map(({ id }) => id));
	const checkIns = source.mealCheckIns
		.map((record) => decode(MealCheckInSchema, record, 'decode check-in for export'))
		.filter(
			(row) =>
				(row.mealId !== null && mealIds.has(row.mealId)) ||
				(row.mealId === null && row.reporterUserId === exporterId)
		);
	// Meal provenance stays as the household has it, even when the recipe belongs to another member.
	const portableMeals = meals.map(withoutConflictClocks);
	const portableCheckIns = checkIns.map(withoutConflictClocks);

	const taxonomy = {
		version: PORTABLE_FILE_VERSION,
		globalSeedVersion: GLOBAL_TAXONOMY_SEED_VERSION,
		foods: source.foods,
		foodAliases: source.foodAliases,
		foodUserAliases: portableUserRows(source.foodUserAliases, exporterId),
		foodHouseholdAliases: portableHouseholdRows(source.foodHouseholdAliases, householdIds),
		foodUserEntries: portableUserRows(source.foodUserEntries, exporterId),
		foodHouseholdEntries: portableHouseholdRows(source.foodHouseholdEntries, householdIds),
		units: source.units,
		unitAliases: source.unitAliases,
		unitUserAliases: portableUserRows(source.unitUserAliases, exporterId),
		unitHouseholdAliases: portableHouseholdRows(source.unitHouseholdAliases, householdIds),
		unitUserEntries: portableUserRows(source.unitUserEntries, exporterId),
		unitHouseholdEntries: portableHouseholdRows(source.unitHouseholdEntries, householdIds)
	};
	const preferences = {
		version: PORTABLE_FILE_VERSION,
		userFoodPreferences: portableUserRows(source.userFoodPreferences, exporterId),
		userFoodDisplayPreferences: portableUserRows(source.userFoodDisplayPreferences, exporterId),
		householdFoodDisplayPreferences: portableHouseholdRows(
			source.householdFoodDisplayPreferences,
			householdIds
		),
		userUnitDisplayPreferences: portableUserRows(source.userUnitDisplayPreferences, exporterId),
		householdUnitDisplayPreferences: portableHouseholdRows(
			source.householdUnitDisplayPreferences,
			householdIds
		)
	};

	const referencedUserIds = new Set<string>([
		exporterId,
		...households.flatMap(({ createdByUserId }) => (createdByUserId ? [createdByUserId] : [])),
		...recipes.map(({ ownerUserId }) => ownerUserId),
		...meals.flatMap(({ plannedCookUserId }) => (plannedCookUserId ? [plannedCookUserId] : [])),
		...checkIns.map(({ reporterUserId }) => reporterUserId)
	]);
	const attributionByUser = new Map<string, PortableUserAttribution>(
		[...source.userAttributions, exporter, ...localUsers].map((attribution) => [
			attribution.workosUserId,
			attribution
		])
	);
	const users = [...referencedUserIds].toSorted().map(
		(workosUserId) =>
			attributionByUser.get(workosUserId) ?? {
				workosUserId,
				displayName: workosUserId,
				profilePictureUrl: null
			}
	);

	const content = {
		users: { version: PORTABLE_FILE_VERSION, users },
		households: { version: PORTABLE_FILE_VERSION, households, appliances },
		recipes: { version: PORTABLE_FILE_VERSION, recipes: activeRecipes },
		meals: { version: PORTABLE_FILE_VERSION, meals: portableMeals },
		checkIns: { version: PORTABLE_FILE_VERSION, checkIns: portableCheckIns },
		taxonomy,
		preferences,
		...(deletedRecipes.length > 0
			? { deletedRecipes: { version: PORTABLE_FILE_VERSION, recipes: deletedRecipes } }
			: {}),
		...(memberships.some(({ status }) => status === 'detached')
			? {
					detachedHouseholds: {
						version: PORTABLE_FILE_VERSION,
						households: memberships
							.filter(({ status }) => status === 'detached')
							.map(({ householdId, detachedAt, denialCode }) => ({
								householdId,
								detachedAt,
								denialCode
							}))
					}
				}
			: {})
	};

	const entryValues: [string, unknown][] = [
		['users.json', content.users],
		['households.json', content.households],
		['recipes.json', content.recipes],
		['meals.json', content.meals],
		['check-ins.json', content.checkIns],
		['taxonomy.json', content.taxonomy],
		['preferences.json', content.preferences],
		...(content.deletedRecipes
			? ([['deleted-recipes.json', content.deletedRecipes]] as [string, unknown][])
			: []),
		...(content.detachedHouseholds
			? ([['detached-households.json', content.detachedHouseholds]] as [string, unknown][])
			: [])
	];
	const manifest = {
		archiveFormatVersion: PORTABLE_ARCHIVE_FORMAT_VERSION,
		domainContractVersion: 1,
		createdAt: options.createdAt ?? (new Date().toISOString() as `${string}Z`),
		exporterWorkosUserId: exporterId,
		appVersion: options.appVersion ?? '0.0.1',
		globalTaxonomySeedVersion: GLOBAL_TAXONOMY_SEED_VERSION,
		files: entryValues.map(([name, value]) => ({
			name,
			bytes: textEncoder.encode(jsonText(value)).byteLength,
			count: fileCount(value)
		}))
	};

	return {
		manifest: decode(PortableManifestSchema, manifest, 'validate manifest export'),
		users: decode(PortableUsersFileSchema, content.users, 'validate users export'),
		households: decode(
			PortableHouseholdsFileSchema,
			content.households,
			'validate households export'
		),
		recipes: decode(PortableRecipesFileSchema, content.recipes, 'validate recipes export'),
		meals: decode(PortableMealsFileSchema, content.meals, 'validate meals export'),
		checkIns: decode(PortableCheckInsFileSchema, content.checkIns, 'validate check-ins export'),
		taxonomy: decode(PortableTaxonomyFileSchema, content.taxonomy, 'validate taxonomy export'),
		preferences: decode(
			PortablePreferencesFileSchema,
			content.preferences,
			'validate preferences export'
		),
		...(content.deletedRecipes
			? {
					deletedRecipes: decode(
						PortableDeletedRecipesFileSchema,
						content.deletedRecipes,
						'validate deleted recipes export'
					)
				}
			: {}),
		...(content.detachedHouseholds
			? {
					detachedHouseholds: decode(
						PortableDetachedHouseholdsFileSchema,
						content.detachedHouseholds,
						'validate detached households export'
					)
				}
			: {})
	};
};

const profileAttribution = ({
	workosUserId,
	displayName,
	profilePictureUrl
}: PortableUserAttribution): PortableUserAttribution => ({
	workosUserId,
	displayName,
	profilePictureUrl
});

export const collectPortableArchive = async (
	database: MaalDatabase,
	profileId: string,
	options: PortableExportOptions = {}
): Promise<PortableArchive> => {
	const [profile, profiles, rows] = await Promise.all([
		database.profiles.get(profileId),
		database.profiles.toArray(),
		Promise.all(
			PORTABLE_SOURCE_STORES.map(async (store) => [store, await database.table(store).toArray()])
		)
	]);
	if (!profile) {
		throw archiveError(
			'invalid_content',
			'select export profile',
			'The export profile is missing.'
		);
	}
	// Each entry holds its own table's rows, which is exactly the PortableSource shape.
	const source = Object.fromEntries(rows) as PortableSource;
	return buildPortableArchive(
		source,
		profileAttribution(profile),
		profiles.map(profileAttribution),
		options
	);
};

const archiveEntries = (archive: PortableArchive): [PortableEntryName, unknown][] => [
	['manifest.json', archive.manifest],
	['users.json', archive.users],
	['households.json', archive.households],
	['recipes.json', archive.recipes],
	['meals.json', archive.meals],
	['check-ins.json', archive.checkIns],
	['taxonomy.json', archive.taxonomy],
	['preferences.json', archive.preferences],
	...(archive.deletedRecipes
		? ([['deleted-recipes.json', archive.deletedRecipes]] as [PortableEntryName, unknown][])
		: []),
	...(archive.detachedHouseholds
		? ([['detached-households.json', archive.detachedHouseholds]] as [PortableEntryName, unknown][])
		: [])
];

export const createPortableArchiveBlob = async (archive: PortableArchive): Promise<Blob> => {
	const writer = new ZipWriter(new BlobWriter('application/zip'));
	for (const [name, value] of archiveEntries(archive)) {
		await writer.add(name, new TextReader(jsonText(value)), { level: 6 });
	}
	return writer.close();
};

export const exportPortableArchive = async (
	database: MaalDatabase,
	profileId: string,
	options?: PortableExportOptions
): Promise<Blob> =>
	createPortableArchiveBlob(await collectPortableArchive(database, profileId, options));

const readEntryText = async (entry: Entry): Promise<string> => {
	if (entry.directory || !('getData' in entry))
		throw archiveError('invalid_zip', 'read archive entry', 'A ZIP entry is unreadable.');
	return entry.getData(new TextWriter());
};

export const decodePortableArchive = async (blob: Blob): Promise<PortableArchive> => {
	if (blob.size > MAX_COMPRESSED_ARCHIVE_BYTES) {
		throw archiveError(
			'resource_limit',
			'open portable archive',
			'The archive is larger than 256 MiB.'
		);
	}
	const reader = new ZipReader(new BlobReader(blob));
	try {
		const entries = await reader.getEntries();
		const seen = new Set<string>();
		let compressedBytes = 0;
		let uncompressedBytes = 0;
		for (const entry of entries) {
			if (
				entry.directory ||
				entry.filename.includes('/') ||
				entry.filename.includes('\\') ||
				!knownEntryNames.has(entry.filename)
			) {
				throw archiveError(
					'invalid_zip',
					'inspect portable archive',
					'The archive has an unknown path.'
				);
			}
			if (seen.has(entry.filename)) {
				throw archiveError(
					'invalid_zip',
					'inspect portable archive',
					'The archive repeats a file name.'
				);
			}
			seen.add(entry.filename);
			compressedBytes += entry.compressedSize;
			uncompressedBytes += entry.uncompressedSize;
			if (entry.uncompressedSize > MAX_JSON_ENTRY_BYTES) {
				throw archiveError(
					'resource_limit',
					'inspect portable archive',
					'A JSON file is larger than 128 MiB.'
				);
			}
		}
		if (
			compressedBytes > MAX_COMPRESSED_ARCHIVE_BYTES ||
			uncompressedBytes > MAX_UNCOMPRESSED_ARCHIVE_BYTES
		) {
			throw archiveError(
				'resource_limit',
				'inspect portable archive',
				'The archive exceeds its size limit.'
			);
		}
		for (const name of REQUIRED_PORTABLE_ENTRY_NAMES) {
			if (!seen.has(name)) {
				throw archiveError(
					'invalid_zip',
					'inspect portable archive',
					`The archive is missing ${name}.`
				);
			}
		}

		const values = new Map<string, { parsed: unknown; bytes: number }>();
		for (const entry of entries) {
			const text = await readEntryText(entry);
			const bytes = textEncoder.encode(text).byteLength;
			if (bytes > MAX_JSON_ENTRY_BYTES) {
				throw archiveError(
					'resource_limit',
					'read portable archive',
					'A JSON file exceeds its limit.'
				);
			}
			values.set(entry.filename, { parsed: parseJson(text, entry.filename), bytes });
		}

		const value = (name: PortableEntryName): unknown => values.get(name)?.parsed;
		const rawManifest = value('manifest.json');
		const rawArchiveVersion =
			typeof rawManifest === 'object' && rawManifest !== null
				? (rawManifest as Record<string, unknown>).archiveFormatVersion
				: undefined;
		if (
			typeof rawArchiveVersion === 'number' &&
			rawArchiveVersion > PORTABLE_ARCHIVE_FORMAT_VERSION
		) {
			throw archiveError(
				'unsupported_version',
				'decode portable archive',
				'This archive was created by a newer Maal version.'
			);
		}
		const manifest = decode(PortableManifestSchema, rawManifest, 'decode manifest.json');
		const summaryNames = new Set<string>();
		for (const summary of manifest.files) {
			if (summaryNames.has(summary.name)) {
				throw archiveError(
					'invalid_content',
					'verify archive summary',
					'A file summary is repeated.'
				);
			}
			summaryNames.add(summary.name);
			const actual = values.get(summary.name);
			if (!actual || actual.bytes !== summary.bytes || fileCount(actual.parsed) !== summary.count) {
				throw archiveError(
					'invalid_content',
					'verify archive summary',
					'An archive file summary does not match.'
				);
			}
		}
		for (const name of seen) {
			if (name !== 'manifest.json' && !summaryNames.has(name)) {
				throw archiveError(
					'invalid_content',
					'verify archive summary',
					'An archive file has no summary.'
				);
			}
		}

		return {
			manifest,
			users: decode(PortableUsersFileSchema, value('users.json'), 'decode users.json'),
			households: decode(
				PortableHouseholdsFileSchema,
				value('households.json'),
				'decode households.json'
			),
			recipes: decode(PortableRecipesFileSchema, value('recipes.json'), 'decode recipes.json'),
			meals: decode(PortableMealsFileSchema, value('meals.json'), 'decode meals.json'),
			checkIns: decode(
				PortableCheckInsFileSchema,
				value('check-ins.json'),
				'decode check-ins.json'
			),
			taxonomy: decode(PortableTaxonomyFileSchema, value('taxonomy.json'), 'decode taxonomy.json'),
			preferences: decode(
				PortablePreferencesFileSchema,
				value('preferences.json'),
				'decode preferences.json'
			),
			...(seen.has('deleted-recipes.json')
				? {
						deletedRecipes: decode(
							PortableDeletedRecipesFileSchema,
							value('deleted-recipes.json'),
							'decode deleted-recipes.json'
						)
					}
				: {}),
			...(seen.has('detached-households.json')
				? {
						detachedHouseholds: decode(
							PortableDetachedHouseholdsFileSchema,
							value('detached-households.json'),
							'decode detached-households.json'
						)
					}
				: {})
		};
	} catch (error) {
		if (error instanceof PortableArchiveError) throw error;
		throw archiveError(
			'invalid_zip',
			'open portable archive',
			'The ZIP file is corrupt or truncated.'
		);
	} finally {
		await reader.close();
	}
};
