import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import {
	executeLocalCommands,
	type LocalCommand,
	type LocalCommandResult
} from '$lib/client/local/commands.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import { LocalDecodeError } from '$lib/domain/contracts/errors.js';
import { DomainIdSchema, UtcInstantSchema } from '$lib/domain/contracts/primitives.js';
import { versionChange } from '$lib/domain/meals/recipe-following.js';
import {
	StoredRecipeSchema,
	isRecipeAggregate,
	type RecipeAggregate
} from '$lib/domain/recipes/schema.js';
import {
	RecipeVersionSchema,
	recipeVersion,
	type RecipeVersion
} from '$lib/domain/recipes/versions.js';

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown, operation: string): A => {
	try {
		return Schema.decodeUnknownSync(schema)(value);
	} catch {
		throw new LocalDecodeError({ operation, message: 'Local data did not match its contract.' });
	}
};

const RecipeVersionPayloadSchema = Schema.Struct({
	recipeId: DomainIdSchema,
	effectiveAt: UtcInstantSchema
});

/** The command that stores a new version, insert-only, in its owner's user scope (spec §5.2). */
const versionCommand = (
	context: { readonly authSlotId: string; readonly originDeviceId: string },
	version: RecipeVersion,
	mutationId: string = uuidv7()
): LocalCommand => ({
	authSlotId: context.authSlotId,
	scopeKind: 'user',
	scopeId: version.ownerUserId,
	entityKind: 'recipeVersion',
	aggregateId: version.id,
	conflictGroup: 'row',
	operation: 'upsert',
	originDeviceId: context.originDeviceId,
	occurredAt: version.effectiveAt,
	mutationId,
	payload: { recipeId: version.recipeId, effectiveAt: version.effectiveAt },
	payloadSchema: RecipeVersionPayloadSchema,
	writes: [
		{
			store: 'recipeVersions',
			aggregateId: version.id,
			identity: { id: version.id, ownerUserId: version.ownerUserId },
			conflictGroups: ['row'],
			schema: RecipeVersionSchema,
			update: (current) => {
				if (current !== undefined) {
					throw new LocalDecodeError({
						operation: 'add recipe version',
						message: 'A recipe version is never rewritten.'
					});
				}
				return version;
			}
		}
	]
});

const readStoredRecipe = async (database: MaalDatabase, recipeId: string) => {
	const stored = await database.recipes.get(recipeId);
	return stored === undefined ? undefined : decode(StoredRecipeSchema, stored, 'read recipe');
};

/**
 * Commits one gesture's commands in a single transaction, adding the version each recipe command
 * makes (spec §5.2). The version holds the recipe exactly as committed, and its mutation ID is
 * minted before the commands run, so it uploads ahead of the recipe change it records. Every recipe
 * write of this device goes through here. Results follow `commands`.
 */
export const executeRecipeCommands = (
	database: MaalDatabase,
	commands: readonly LocalCommand[]
): Promise<LocalCommandResult[]> => {
	const tables = new Set([
		database.recipes,
		database.recipeVersions,
		database.outbox,
		...commands.flatMap(({ writes }) => writes.map(({ store }) => database.table(store)))
	]);
	return database.transaction('rw', [...tables], async () => {
		const recipeCommands = commands.flatMap((command, index) =>
			command.entityKind === 'recipe' ? [{ command, index, mutationId: uuidv7() }] : []
		);
		const before = await Promise.all(
			recipeCommands.map(({ command }) => readStoredRecipe(database, command.aggregateId))
		);
		const results = await executeLocalCommands(database, commands);
		const versions = recipeCommands.flatMap(({ command, index, mutationId }, position) => {
			const after = decode(StoredRecipeSchema, results[index]!.aggregates[0], 'read recipe');
			const change = versionChange(before[position], after);
			if (change === null) return [];
			const version = recipeVersion({
				id: uuidv7(),
				recipeId: command.aggregateId,
				ownerUserId: command.scopeId,
				effectiveAt: decode(UtcInstantSchema, command.occurredAt, 'decode recipe change time'),
				recipe: change === 'content' && isRecipeAggregate(after) ? after : null
			});
			return [versionCommand(command, version, mutationId)];
		});
		if (versions.length > 0) await executeLocalCommands(database, versions);
		return results;
	});
};

/** Every stored version of these recipes, decoded. */
export const readRecipeVersions = async (
	database: MaalDatabase,
	recipeIds: Iterable<string>
): Promise<RecipeVersion[]> => {
	const ids = [...new Set(recipeIds)];
	if (ids.length === 0) return [];
	return (await database.recipeVersions.where('recipeId').anyOf(ids).toArray()).map((row) =>
		decode(RecipeVersionSchema, row, 'decode recipe version')
	);
};

/**
 * The first version of a recipe stored before versions existed, which its owner adds on planning
 * it (spec §5.2). None when the recipe has a version or `plannerUserId` does not own it.
 */
export const firstVersionCommands = async (
	database: MaalDatabase,
	context: { readonly authSlotId: string; readonly originDeviceId: string },
	recipe: RecipeAggregate,
	plannerUserId: string
): Promise<LocalCommand[]> => {
	if (recipe.ownerUserId !== plannerUserId) return [];
	if ((await database.recipeVersions.where('recipeId').equals(recipe.id).count()) > 0) return [];
	return [
		versionCommand(
			context,
			recipeVersion({
				id: uuidv7(),
				recipeId: recipe.id,
				ownerUserId: recipe.ownerUserId,
				effectiveAt: recipe.updatedAt,
				recipe
			})
		)
	];
};
