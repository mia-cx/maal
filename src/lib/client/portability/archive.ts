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
import { Schema } from 'effect';

import type { MaalDatabase } from '$lib/client/local/database.js';
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

const visibleRows = async <A extends { workosUserId: string }>(
	rows: Promise<A[]>,
	workosUserId: string
): Promise<A[]> => (await rows).filter((row) => row.workosUserId === workosUserId);

const visibleHouseholdRows = async <A extends { householdId: string }>(
	rows: Promise<A[]>,
	householdIds: ReadonlySet<string>
): Promise<A[]> => (await rows).filter((row) => householdIds.has(row.householdId));

const portableUserRows = async <A extends { workosUserId: string; conflictClocks: unknown }>(
	rows: Promise<A[]>,
	workosUserId: string
): Promise<Omit<A, 'conflictClocks'>[]> =>
	(await visibleRows(rows, workosUserId)).map(withoutConflictClocks);

const portableHouseholdRows = async <A extends { householdId: string; conflictClocks: unknown }>(
	rows: Promise<A[]>,
	householdIds: ReadonlySet<string>
): Promise<Omit<A, 'conflictClocks'>[]> =>
	(await visibleHouseholdRows(rows, householdIds)).map(withoutConflictClocks);

export interface PortableExportOptions {
	readonly appVersion?: string;
	readonly createdAt?: `${string}Z`;
}

export const collectPortableArchive = async (
	database: MaalDatabase,
	profileId: string,
	options: PortableExportOptions = {}
): Promise<PortableArchive> => {
	const profile = await database.profiles.get(profileId);
	if (!profile) {
		throw archiveError(
			'invalid_content',
			'select export profile',
			'The export profile is missing.'
		);
	}
	const memberships = await database.memberships
		.where('workosUserId')
		.equals(profile.workosUserId)
		.filter(({ status }) => status !== 'revoked')
		.toArray();
	const householdIds = new Set(memberships.map(({ householdId }) => householdId));
	const households = (
		await database.households
			.filter(
				({ householdId, deletionState }) =>
					householdIds.has(householdId) && deletionState !== 'purged'
			)
			.toArray()
	).map(withoutConflictClocks);
	const appliances = (
		await visibleHouseholdRows(database.householdAppliances.toArray(), householdIds)
	).map(withoutConflictClocks);
	const storedRecipes = await database.recipes
		.where('ownerUserId')
		.equals(profile.workosUserId)
		.toArray();
	const recipes = storedRecipes
		.map((record) => decode(StoredRecipeSchema, record, 'decode recipe for export'))
		.filter(isRecipeAggregate);
	const activeRecipes = recipes
		.filter(({ deletedAt }) => deletedAt === null)
		.map(withoutConflictClocks);
	const deletedRecipes = recipes
		.filter(({ deletedAt }) => deletedAt !== null)
		.map(withoutConflictClocks);
	const meals = (await database.meals.toArray())
		.map((record) => decode(StoredMealSchema, record, 'decode meal for export'))
		.filter(isMealAggregate)
		.filter(({ householdId }) => householdIds.has(householdId));
	const mealIds = new Set(meals.map(({ id }) => id));
	const checkIns = (await database.mealCheckIns.toArray())
		.map((record) => decode(MealCheckInSchema, record, 'decode check-in for export'))
		.filter(
			(row) =>
				(row.mealId !== null && mealIds.has(row.mealId)) ||
				(row.mealId === null && row.reporterUserId === profile.workosUserId)
		);
	const exportedRecipeIds = new Set(recipes.map(({ id }) => id));
	const portableMeals = meals.map((meal) => ({
		...withoutConflictClocks(meal),
		sourceRecipeId:
			meal.sourceRecipeId !== null && exportedRecipeIds.has(meal.sourceRecipeId)
				? meal.sourceRecipeId
				: null
	}));
	const portableCheckIns = checkIns.map(withoutConflictClocks);

	const taxonomy = {
		version: PORTABLE_FILE_VERSION,
		globalSeedVersion: GLOBAL_TAXONOMY_SEED_VERSION,
		foods: await database.foods.toArray(),
		foodAliases: await database.foodAliases.toArray(),
		foodUserAliases: await portableUserRows(
			database.foodUserAliases.toArray(),
			profile.workosUserId
		),
		foodHouseholdAliases: await portableHouseholdRows(
			database.foodHouseholdAliases.toArray(),
			householdIds
		),
		foodUserEntries: await portableUserRows(
			database.foodUserEntries.toArray(),
			profile.workosUserId
		),
		foodHouseholdEntries: await portableHouseholdRows(
			database.foodHouseholdEntries.toArray(),
			householdIds
		),
		units: await database.units.toArray(),
		unitAliases: await database.unitAliases.toArray(),
		unitUserAliases: await portableUserRows(
			database.unitUserAliases.toArray(),
			profile.workosUserId
		),
		unitHouseholdAliases: await portableHouseholdRows(
			database.unitHouseholdAliases.toArray(),
			householdIds
		),
		unitUserEntries: await portableUserRows(
			database.unitUserEntries.toArray(),
			profile.workosUserId
		),
		unitHouseholdEntries: await portableHouseholdRows(
			database.unitHouseholdEntries.toArray(),
			householdIds
		)
	};
	const preferences = {
		version: PORTABLE_FILE_VERSION,
		userFoodPreferences: await portableUserRows(
			database.userFoodPreferences.toArray(),
			profile.workosUserId
		),
		userFoodDisplayPreferences: await portableUserRows(
			database.userFoodDisplayPreferences.toArray(),
			profile.workosUserId
		),
		householdFoodDisplayPreferences: await portableHouseholdRows(
			database.householdFoodDisplayPreferences.toArray(),
			householdIds
		),
		userUnitDisplayPreferences: await portableUserRows(
			database.userUnitDisplayPreferences.toArray(),
			profile.workosUserId
		),
		householdUnitDisplayPreferences: await portableHouseholdRows(
			database.householdUnitDisplayPreferences.toArray(),
			householdIds
		)
	};

	const referencedUserIds = new Set<string>([
		profile.workosUserId,
		...households.flatMap(({ createdByUserId }) => (createdByUserId ? [createdByUserId] : [])),
		...recipes.map(({ ownerUserId }) => ownerUserId),
		...meals.flatMap(({ plannedCookUserId }) => (plannedCookUserId ? [plannedCookUserId] : [])),
		...checkIns.map(({ reporterUserId }) => reporterUserId)
	]);
	const [profiles, storedAttributions] = await Promise.all([
		database.profiles.toArray(),
		database.userAttributions.toArray()
	]);
	const attributionByUser = new Map(
		storedAttributions.map((attribution) => [attribution.workosUserId, attribution])
	);
	for (const localProfile of profiles) {
		attributionByUser.set(localProfile.workosUserId, {
			workosUserId: localProfile.workosUserId,
			displayName: localProfile.displayName,
			profilePictureUrl: localProfile.profilePictureUrl
		});
	}
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
		exporterWorkosUserId: profile.workosUserId,
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
