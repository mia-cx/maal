import { Schema } from 'effect';

import {
	DomainIdSchema,
	MutableAggregateFields,
	UtcInstantSchema,
	type UtcInstant
} from '$lib/domain/contracts/primitives.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';

import { RecipeAggregateSchema, type RecipeAggregate } from './schema.js';

/**
 * An immutable record of a recipe at one change (spec §5.2). `recipe` is the complete recipe as of
 * the version; null marks a deletion. `effectiveAt` is when the owner made the change. Nothing
 * rewrites a version, so it syncs insert-only and never conflicts.
 */
export const RecipeVersionSchema = Schema.Struct({
	...MutableAggregateFields,
	id: DomainIdSchema,
	recipeId: DomainIdSchema,
	ownerUserId: Schema.String.pipe(Schema.minLength(1)),
	effectiveAt: UtcInstantSchema,
	recipe: Schema.NullOr(RecipeAggregateSchema)
});
export type RecipeVersion = typeof RecipeVersionSchema.Type;
/** A version that holds recipe content, as opposed to a deletion marker. */
export type ContentVersion = RecipeVersion & { readonly recipe: RecipeAggregate };

export const isContentVersion = (version: RecipeVersion): version is ContentVersion =>
	version.recipe !== null;

/** Orders versions by when they took effect, then by ID, oldest first (spec §5.3). */
export const byEffect = (left: RecipeVersion, right: RecipeVersion): number =>
	left.effectiveAt === right.effectiveAt
		? left.id.localeCompare(right.id)
		: left.effectiveAt.localeCompare(right.effectiveAt);

/** A new version of `recipeId`: its content, or a deletion marker when `recipe` is null. */
export const recipeVersion = (input: {
	readonly id: string;
	readonly recipeId: string;
	readonly ownerUserId: string;
	readonly effectiveAt: string;
	readonly recipe: RecipeAggregate | null;
}): RecipeVersion =>
	Schema.decodeUnknownSync(RecipeVersionSchema)({
		schemaVersion: CURRENT_SCHEMA_VERSION,
		revision: 0,
		createdAt: input.effectiveAt,
		updatedAt: input.effectiveAt,
		deletedAt: null,
		conflictClocks: {},
		id: input.id,
		recipeId: input.recipeId,
		ownerUserId: input.ownerUserId,
		effectiveAt: input.effectiveAt,
		recipe: input.recipe
	});

/** The newest content version, or undefined when there is none. */
export const newestContentVersion = (
	versions: readonly RecipeVersion[]
): ContentVersion | undefined => versions.filter(isContentVersion).toSorted(byEffect).at(-1);

/** One millisecond after `instant`, for a version that must sort after another. */
export const justAfter = (instant: UtcInstant | string): UtcInstant =>
	new Date(Date.parse(instant) + 1).toISOString() as UtcInstant;
