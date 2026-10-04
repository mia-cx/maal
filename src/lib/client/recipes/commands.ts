import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';

import {
	executeLocalCommand,
	executeLocalCommands,
	type LocalCommand
} from '$lib/client/local/commands.js';
import type { MaalDatabase } from '$lib/client/local/database.js';
import {
	planMealCommand,
	recipeProvenanceDetachCommands,
	type MealCommandContext,
	type PlanMealOptions
} from '$lib/client/meals/commands.js';
import { LocalDecodeError } from '$lib/domain/contracts/errors.js';
import {
	DomainIdSchema,
	UtcInstantSchema,
	type UtcInstant
} from '$lib/domain/contracts/primitives.js';
import { CURRENT_SCHEMA_VERSION } from '$lib/domain/contracts/versions.js';
import { MealAggregateSchema, type MealAggregate } from '$lib/domain/meals/schema.js';
import {
	RECIPE_CONFLICT_GROUPS,
	RecipeAggregateSchema,
	RecipeImportedCandidateSchema,
	StoredRecipeSchema,
	isRecipeAggregate,
	type RecipeAggregate,
	type RecipeImportedCandidate,
	type RecipeIngredient,
	type RecipeInstruction,
	type RecipePurgeTombstone
} from '$lib/domain/recipes/schema.js';
import {
	normalizeIngredientSource,
	parseInstructionEvents
} from '$lib/recipes/source-normalization.js';

const NullableStringSchema = Schema.NullOr(Schema.String);
const NullableNonNegativeIntSchema = Schema.NullOr(Schema.NonNegativeInt);
const NullableFiniteNumberSchema = Schema.NullOr(
	Schema.Number.pipe(Schema.filter(Number.isFinite))
);

export const RecipeIngredientEditSchema = Schema.Struct({
	id: Schema.NullOr(DomainIdSchema),
	amount: Schema.String,
	unit: Schema.String,
	item: Schema.String
});
export type RecipeIngredientEdit = typeof RecipeIngredientEditSchema.Type;

export const RecipeInstructionEditSchema = Schema.Struct({
	id: Schema.NullOr(DomainIdSchema),
	position: Schema.Int.pipe(Schema.greaterThan(0)),
	text: Schema.String
});
export type RecipeInstructionEdit = typeof RecipeInstructionEditSchema.Type;

export const RecipeEditorPatchSchema = Schema.Struct({
	title: Schema.String.pipe(Schema.minLength(1)),
	description: NullableStringSchema,
	imageUrl: NullableStringSchema,
	sourceUrl: NullableStringSchema,
	sourceSiteName: NullableStringSchema,
	sourceAuthorName: NullableStringSchema,
	sourcePublisherName: NullableStringSchema,
	sourceIsBasedOnUrl: NullableStringSchema,
	prepTimeMinutes: NullableNonNegativeIntSchema,
	cookTimeMinutes: NullableNonNegativeIntSchema,
	yield: NullableFiniteNumberSchema,
	ingredients: Schema.Array(RecipeIngredientEditSchema),
	instructions: Schema.Array(RecipeInstructionEditSchema)
});
export type RecipeEditorPatch = typeof RecipeEditorPatchSchema.Type;

const RecipeMutationPayloadSchema = Schema.Struct({
	recipeId: DomainIdSchema,
	conflictGroups: Schema.Array(Schema.String),
	patch: Schema.Unknown
});

const RecipeDeletePayloadSchema = Schema.Struct({
	recipeId: DomainIdSchema,
	deletedAt: UtcInstantSchema,
	permanent: Schema.Boolean,
	reason: Schema.NullOr(Schema.Literal('permanent_delete', 'recovery_expired'))
});

export interface RecipeCommandContext {
	authSlotId: string;
	ownerUserId: string;
	originDeviceId: string;
	occurredAt?: UtcInstant;
}

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown, operation: string): A => {
	try {
		return Schema.decodeUnknownSync(schema)(value);
	} catch {
		throw new LocalDecodeError({ operation, message: 'Recipe data did not match its contract.' });
	}
};

const commandTime = (context: Pick<RecipeCommandContext, 'occurredAt'>): UtcInstant =>
	decode(
		UtcInstantSchema,
		context.occurredAt ?? new Date().toISOString(),
		'decode recipe mutation time'
	);

const requireOwnedRecipe = (
	record: unknown,
	ownerUserId: string,
	operation: string
): RecipeAggregate => {
	const stored = decode(StoredRecipeSchema, record, operation);
	if (!isRecipeAggregate(stored) || stored.ownerUserId !== ownerUserId) {
		throw new LocalDecodeError({
			operation,
			message: 'The recipe is not available to this profile.'
		});
	}
	return stored;
};

export const recipeSearchTokens = (recipe: {
	title: string;
	description: string | null;
	sourceSiteName: string | null;
	sourceAuthorName: string | null;
	ingredients: readonly { sourceFoodLabel: string; originalText: string }[];
	classifications: readonly { value: string; normalizedValue: string }[];
}): string[] => {
	const normalized = [
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
		.filter((value): value is string => Boolean(value))
		.flatMap((value) =>
			value
				.normalize('NFKD')
				.replace(/[\u0300-\u036f]/g, '')
				.toLocaleLowerCase()
				.split(/[^\p{L}\p{N}]+/u)
				.filter(Boolean)
		);
	return [...new Set(normalized)];
};

const reconcileIngredients = (
	current: readonly RecipeIngredient[],
	edits: readonly RecipeIngredientEdit[],
	occurredAt: UtcInstant
): RecipeIngredient[] => {
	const byId = new Map(current.map((ingredient) => [ingredient.id, ingredient]));
	return edits
		.filter(({ item }) => item.trim().length > 0)
		.map((edit, lineIndex) => {
			const existing = edit.id === null ? undefined : byId.get(edit.id);
			const amount = edit.amount.trim();
			const unit = edit.unit.trim();
			const item = edit.item.trim();
			// An untouched line keeps its stored source text and normalization.
			if (
				existing &&
				existing.sourceAmountText === (amount || null) &&
				existing.sourceUnitLabel === (unit || null) &&
				existing.sourceFoodLabel === item
			) {
				return existing.lineIndex === lineIndex ? existing : { ...existing, lineIndex };
			}
			const normalized = normalizeIngredientSource({
				originalText: [amount, unit, item].filter(Boolean).join(' '),
				amount,
				unit,
				item
			});
			return {
				id: existing?.id ?? uuidv7(),
				lineIndex,
				...normalized,
				// An amount/unit-only edit re-derives units but keeps the resolved food link.
				baseFoodId: existing?.sourceFoodLabel === item ? existing.baseFoodId : null,
				optional: existing?.optional ?? false,
				confidence: 1,
				createdAt: existing?.createdAt ?? occurredAt
			};
		});
};

const reconcileInstructions = (
	current: readonly RecipeInstruction[],
	edits: readonly RecipeInstructionEdit[],
	occurredAt: UtcInstant
): RecipeInstruction[] => {
	const byId = new Map(current.map((instruction) => [instruction.id, instruction]));
	return edits
		.filter(({ text }) => text.trim().length > 0)
		.toSorted((left, right) => left.position - right.position)
		.map((edit, stepIndex) => {
			const existing = edit.id === null ? undefined : byId.get(edit.id);
			const text = edit.text.trim();
			if (existing && existing.stepIndex === stepIndex && existing.text === text) return existing;
			return {
				id: existing?.id ?? uuidv7(),
				stepIndex,
				sectionName: existing?.sectionName ?? null,
				text,
				durationMinutes: existing?.durationMinutes ?? null,
				confidence: existing?.confidence ?? 1,
				createdAt: existing?.createdAt ?? occurredAt,
				updatedAt: occurredAt
			};
		});
};

/**
 * Builds the ingredient, instruction, and instruction-event sidecars for an editor save. Edited
 * lines are parsed again; untouched lines and the events of unchanged instruction text are kept.
 */
export const reconcileRecipeLines = (
	current: Pick<RecipeImportedCandidate, 'ingredients' | 'instructions' | 'instructionEvents'>,
	patch: Pick<RecipeEditorPatch, 'ingredients' | 'instructions'>,
	occurredAt: UtcInstant
): Pick<RecipeImportedCandidate, 'ingredients' | 'instructions' | 'instructionEvents'> => {
	const instructions = reconcileInstructions(current.instructions, patch.instructions, occurredAt);
	const previousText = new Map(current.instructions.map(({ id, text }) => [id, text]));
	return {
		ingredients: reconcileIngredients(current.ingredients, patch.ingredients, occurredAt),
		instructions,
		instructionEvents: instructions.flatMap((instruction) =>
			previousText.get(instruction.id) === instruction.text
				? current.instructionEvents.filter(
						({ recipeInstructionId }) => recipeInstructionId === instruction.id
					)
				: parseInstructionEvents(instruction, occurredAt)
		)
	};
};

const recipeWriteCommand = (
	context: RecipeCommandContext,
	recipeId: string,
	conflictGroups: readonly string[],
	payload: unknown,
	update: (current: unknown | undefined) => unknown,
	operation: 'upsert' | 'delete' = 'upsert'
): LocalCommand => ({
	authSlotId: context.authSlotId,
	scopeKind: 'user',
	scopeId: context.ownerUserId,
	entityKind: 'recipe',
	aggregateId: recipeId,
	conflictGroup: conflictGroups.length === 1 ? conflictGroups[0]! : 'aggregate',
	operation,
	originDeviceId: context.originDeviceId,
	occurredAt: commandTime(context),
	payload,
	payloadSchema: operation === 'delete' ? RecipeDeletePayloadSchema : RecipeMutationPayloadSchema,
	writes: [
		{
			store: 'recipes',
			aggregateId: recipeId,
			identity: { id: recipeId, ownerUserId: context.ownerUserId },
			conflictGroups,
			schema: StoredRecipeSchema,
			update
		}
	]
});

const executeRecipeWrite = (
	database: MaalDatabase,
	...command: Parameters<typeof recipeWriteCommand>
) => executeLocalCommand(database, recipeWriteCommand(...command));

const createRecipeCommand = (
	context: RecipeCommandContext,
	patchInput: RecipeEditorPatch,
	recipeId: string
): { recipe: RecipeAggregate; command: LocalCommand } => {
	const occurredAt = commandTime(context);
	const patch = decode(RecipeEditorPatchSchema, patchInput, 'decode recipe editor patch');
	const lines = reconcileRecipeLines(
		{ ingredients: [], instructions: [], instructionEvents: [] },
		patch,
		occurredAt
	);
	const candidateWithoutSearch = {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		revision: 1,
		createdAt: occurredAt,
		updatedAt: occurredAt,
		deletedAt: null,
		conflictClocks: {},
		id: decode(DomainIdSchema, recipeId, 'decode recipe ID'),
		ownerUserId: context.ownerUserId,
		savedFromHouseholdId: null,
		title: patch.title.trim(),
		description: patch.description,
		imageUrl: patch.imageUrl,
		prepTimeMinutes: patch.prepTimeMinutes,
		cookTimeMinutes: patch.cookTimeMinutes,
		totalTimeMinutes: null,
		yield: patch.yield,
		sourceYieldText: null,
		sourceClaimedMinutes: null,
		sourceDatePublished: null,
		sourceDateModified: null,
		sourceLanguage: null,
		sourceUrl: patch.sourceUrl,
		sourceSiteName: patch.sourceSiteName,
		sourceAuthorName: patch.sourceAuthorName,
		sourcePublisherName: patch.sourcePublisherName,
		sourceIsBasedOnUrl: patch.sourceIsBasedOnUrl,
		sourceImportedAt: occurredAt,
		sourceHtmlHash: null,
		sourceRatingValue: null,
		sourceRatingCount: null,
		sourceReviewCount: null,
		parseConfidence: null,
		ingredientConfidence: null,
		instructionConfidence: null,
		nutritionConfidence: null,
		userNotes: null,
		...lines,
		applianceRequirements: [],
		classifications: [],
		media: [],
		nutritionFacts: [],
		searchTokens: []
	} satisfies RecipeAggregate;
	const candidate: RecipeAggregate = {
		...candidateWithoutSearch,
		searchTokens: recipeSearchTokens(candidateWithoutSearch)
	};
	const command = recipeWriteCommand(
		{ ...context, occurredAt },
		candidate.id,
		RECIPE_CONFLICT_GROUPS,
		{ recipeId: candidate.id, conflictGroups: [...RECIPE_CONFLICT_GROUPS], patch },
		(current) => {
			if (current !== undefined) {
				throw new LocalDecodeError({
					operation: 'create recipe',
					message: 'A recipe with this ID already exists.'
				});
			}
			return candidate;
		}
	);
	return { recipe: candidate, command };
};

export const createRecipeFromEditor = async (
	database: MaalDatabase,
	context: RecipeCommandContext,
	patchInput: RecipeEditorPatch,
	recipeId = uuidv7()
): Promise<RecipeAggregate> => {
	const { command } = createRecipeCommand(context, patchInput, recipeId);
	const result = await executeLocalCommand(database, command);
	return decode(RecipeAggregateSchema, result.aggregates[0], 'decode created recipe');
};

/**
 * The plan route's "new recipe" gesture: creates the reporter's recipe and plans it as a household meal
 * in one transaction, so a failure leaves neither behind.
 */
export const createRecipeAndPlanMeal = async (
	database: MaalDatabase,
	context: MealCommandContext,
	patchInput: RecipeEditorPatch,
	options: PlanMealOptions = {}
): Promise<{ recipe: RecipeAggregate; meal: MealAggregate }> => {
	const occurredAt = commandTime(context);
	const { recipe, command } = createRecipeCommand(
		{
			authSlotId: context.authSlotId,
			ownerUserId: context.reporterUserId,
			originDeviceId: context.originDeviceId,
			occurredAt
		},
		patchInput,
		uuidv7()
	);
	const [created, planned] = await executeLocalCommands(database, [
		command,
		planMealCommand({ ...context, occurredAt }, recipe, options)
	]);
	return {
		recipe: decode(RecipeAggregateSchema, created!.aggregates[0], 'decode created recipe'),
		meal: decode(MealAggregateSchema, planned!.aggregates[0], 'decode planned meal')
	};
};

export const updateRecipeFromEditor = async (
	database: MaalDatabase,
	context: RecipeCommandContext,
	recipeId: string,
	patchInput: RecipeEditorPatch
): Promise<RecipeAggregate> => {
	const occurredAt = commandTime(context);
	const patch = decode(RecipeEditorPatchSchema, patchInput, 'decode recipe editor patch');
	const result = await executeRecipeWrite(
		database,
		{ ...context, occurredAt },
		recipeId,
		['header', 'ingredients', 'instructions'],
		{ recipeId, conflictGroups: ['header', 'ingredients', 'instructions'], patch },
		(current) => {
			const recipe = requireOwnedRecipe(current, context.ownerUserId, 'update recipe');
			const nextWithoutSearch = {
				...recipe,
				title: patch.title.trim(),
				description: patch.description,
				imageUrl: patch.imageUrl,
				sourceUrl: patch.sourceUrl,
				sourceSiteName: patch.sourceSiteName,
				sourceAuthorName: patch.sourceAuthorName,
				sourcePublisherName: patch.sourcePublisherName,
				sourceIsBasedOnUrl: patch.sourceIsBasedOnUrl,
				prepTimeMinutes: patch.prepTimeMinutes,
				cookTimeMinutes: patch.cookTimeMinutes,
				yield: patch.yield,
				...reconcileRecipeLines(recipe, patch, occurredAt),
				searchTokens: []
			} satisfies RecipeAggregate;
			return {
				...nextWithoutSearch,
				searchTokens: recipeSearchTokens(nextWithoutSearch)
			};
		}
	);
	return decode(RecipeAggregateSchema, result.aggregates[0], 'decode updated recipe');
};

const importedCandidateCommand = (
	context: RecipeCommandContext,
	candidateInput: RecipeImportedCandidate,
	recipeId: string
): { recipe: RecipeAggregate; command: LocalCommand } => {
	const occurredAt = commandTime(context);
	const candidate = decode(
		RecipeImportedCandidateSchema,
		candidateInput,
		'decode imported recipe candidate'
	);
	const aggregateWithoutSearch = {
		...candidate,
		schemaVersion: CURRENT_SCHEMA_VERSION,
		revision: 1,
		createdAt: occurredAt,
		updatedAt: occurredAt,
		deletedAt: null,
		conflictClocks: {},
		id: decode(DomainIdSchema, recipeId, 'decode recipe ID'),
		ownerUserId: context.ownerUserId,
		searchTokens: []
	} satisfies RecipeAggregate;
	const aggregate: RecipeAggregate = {
		...aggregateWithoutSearch,
		searchTokens: recipeSearchTokens(aggregateWithoutSearch)
	};
	const command = recipeWriteCommand(
		{ ...context, occurredAt },
		aggregate.id,
		RECIPE_CONFLICT_GROUPS,
		{ recipeId: aggregate.id, conflictGroups: [...RECIPE_CONFLICT_GROUPS], patch: candidate },
		(current) => {
			if (current !== undefined) {
				throw new LocalDecodeError({
					operation: 'commit imported recipe',
					message: 'A recipe with this ID already exists.'
				});
			}
			return aggregate;
		}
	);
	return { recipe: aggregate, command };
};

export const commitImportedRecipeCandidate = async (
	database: MaalDatabase,
	context: RecipeCommandContext,
	candidateInput: RecipeImportedCandidate,
	recipeId = uuidv7()
): Promise<RecipeAggregate> => {
	const { command } = importedCandidateCommand(context, candidateInput, recipeId);
	const result = await executeLocalCommand(database, command);
	return decode(RecipeAggregateSchema, result.aggregates[0], 'decode imported recipe');
};

export const updateRecipeFromImportedCandidate = async (
	database: MaalDatabase,
	context: RecipeCommandContext,
	recipeId: string,
	candidateInput: RecipeImportedCandidate
): Promise<RecipeAggregate> => {
	const candidate = decode(
		RecipeImportedCandidateSchema,
		candidateInput,
		'decode imported recipe candidate'
	);
	const conflictGroups = RECIPE_CONFLICT_GROUPS.filter((group) => group !== 'deletion');
	const result = await executeRecipeWrite(
		database,
		context,
		recipeId,
		conflictGroups,
		{ recipeId, conflictGroups, patch: candidate },
		(current) => ({
			...requireOwnedRecipe(current, context.ownerUserId, 'update imported recipe'),
			...candidate,
			searchTokens: recipeSearchTokens(candidate)
		})
	);
	return decode(RecipeAggregateSchema, result.aggregates[0], 'decode updated imported recipe');
};

/**
 * The plan route's "import from URL" gesture: commits the reporter's recipe and plans it as a
 * household meal in one transaction, so a planning failure leaves no recipe behind.
 */
export const commitImportedCandidateAndPlanMeal = async (
	database: MaalDatabase,
	context: MealCommandContext,
	candidateInput: RecipeImportedCandidate,
	options: PlanMealOptions = {}
): Promise<{ recipe: RecipeAggregate; meal: MealAggregate }> => {
	const occurredAt = commandTime(context);
	const { recipe, command } = importedCandidateCommand(
		{
			authSlotId: context.authSlotId,
			ownerUserId: context.reporterUserId,
			originDeviceId: context.originDeviceId,
			occurredAt
		},
		candidateInput,
		uuidv7()
	);
	const [created, planned] = await executeLocalCommands(database, [
		command,
		planMealCommand({ ...context, occurredAt }, recipe, options)
	]);
	return {
		recipe: decode(RecipeAggregateSchema, created!.aggregates[0], 'decode imported recipe'),
		meal: decode(MealAggregateSchema, planned!.aggregates[0], 'decode planned meal')
	};
};

export const deleteRecipe = async (
	database: MaalDatabase,
	context: RecipeCommandContext,
	recipeId: string
): Promise<RecipeAggregate> => {
	const deletedAt = commandTime(context);
	const result = await executeRecipeWrite(
		database,
		{ ...context, occurredAt: deletedAt },
		recipeId,
		['deletion'],
		{ recipeId, deletedAt, permanent: false, reason: null },
		(current) => ({
			...requireOwnedRecipe(current, context.ownerUserId, 'delete recipe'),
			deletedAt
		}),
		'delete'
	);
	return decode(RecipeAggregateSchema, result.aggregates[0], 'decode deleted recipe');
};

export const restoreRecipe = async (
	database: MaalDatabase,
	context: RecipeCommandContext,
	recipeId: string
): Promise<RecipeAggregate> => {
	const occurredAt = commandTime(context);
	const result = await executeRecipeWrite(
		database,
		{ ...context, occurredAt },
		recipeId,
		['deletion'],
		{ recipeId, conflictGroups: ['deletion'], patch: { deletedAt: null } },
		(current) => ({
			...requireOwnedRecipe(current, context.ownerUserId, 'restore recipe'),
			deletedAt: null
		})
	);
	return decode(RecipeAggregateSchema, result.aggregates[0], 'decode restored recipe');
};

const purgeRecipe = async (
	database: MaalDatabase,
	context: RecipeCommandContext,
	recipeId: string,
	reason: 'permanent_delete' | 'recovery_expired'
): Promise<RecipePurgeTombstone> => {
	const purgedAt = commandTime(context);
	const retainUntil = new Date(Date.parse(purgedAt) + 365 * 86_400_000).toISOString() as UtcInstant;
	const purge = recipeWriteCommand(
		{ ...context, occurredAt: purgedAt },
		recipeId,
		['deletion'],
		{ recipeId, deletedAt: purgedAt, permanent: true, reason },
		(current) => {
			const recipe = requireOwnedRecipe(current, context.ownerUserId, 'permanently delete recipe');
			return {
				id: recipe.id,
				ownerUserId: recipe.ownerUserId,
				schemaVersion: recipe.schemaVersion,
				revision: recipe.revision,
				createdAt: recipe.createdAt,
				updatedAt: purgedAt,
				deletedAt: recipe.deletedAt ?? purgedAt,
				conflictClocks: recipe.conflictClocks,
				purgedAt,
				retainUntil,
				purgeReason: reason,
				searchTokens: []
			};
		},
		'delete'
	);
	// The recoverable delete keeps meal provenance so a restore brings the history back; only the
	// purge severs it, together with the content, in the same transaction.
	const detach = await recipeProvenanceDetachCommands(
		database,
		{
			authSlotId: context.authSlotId,
			reporterUserId: context.ownerUserId,
			originDeviceId: context.originDeviceId,
			occurredAt: purgedAt
		},
		recipeId
	);
	const [result] = await executeLocalCommands(database, [purge, ...detach]);
	return decode(
		StoredRecipeSchema,
		result!.aggregates[0],
		'decode recipe tombstone'
	) as RecipePurgeTombstone;
};

export const permanentlyDeleteRecipe = (
	database: MaalDatabase,
	context: RecipeCommandContext,
	recipeId: string
): Promise<RecipePurgeTombstone> => purgeRecipe(database, context, recipeId, 'permanent_delete');

export const runRecipeRetention = async (
	database: MaalDatabase,
	context: RecipeCommandContext,
	now: UtcInstant = commandTime(context),
	batchSize = 25
): Promise<{ purgedRecipeIds: string[]; expiredTombstoneIds: string[]; hasMore: boolean }> => {
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
		throw new TypeError('Recipe retention batch size must be between 1 and 100.');
	}
	const cutoff = Date.parse(now) - 30 * 86_400_000;
	const records = await database.recipes.where('ownerUserId').equals(context.ownerUserId).toArray();
	const stored = records.map((record) =>
		decode(StoredRecipeSchema, record, 'decode recipe retention row')
	);
	const recoverableExpired = stored
		.filter(
			(record): record is RecipeAggregate =>
				isRecipeAggregate(record) &&
				record.deletedAt !== null &&
				Date.parse(record.deletedAt) <= cutoff
		)
		.slice(0, batchSize);
	const purgedRecipeIds: string[] = [];
	for (const recipe of recoverableExpired) {
		await purgeRecipe(database, { ...context, occurredAt: now }, recipe.id, 'recovery_expired');
		purgedRecipeIds.push(recipe.id);
	}
	const acknowledgedDeletes = new Set(
		(
			await database.outbox
				.where('[scopeKind+scopeId+status]')
				.equals(['user', context.ownerUserId, 'acknowledged'])
				.toArray()
		)
			.filter(({ entityKind, operation }) => entityKind === 'recipe' && operation === 'delete')
			.map(({ aggregateId }) => aggregateId)
	);
	const expiredCandidates = stored
		.filter(
			(record): record is RecipePurgeTombstone =>
				!isRecipeAggregate(record) &&
				Date.parse(record.retainUntil) <= Date.parse(now) &&
				acknowledgedDeletes.has(record.id)
		)
		.map(({ id }) => id);
	const expiredTombstoneIds = expiredCandidates.slice(0, batchSize);
	if (expiredTombstoneIds.length > 0) await database.recipes.bulkDelete(expiredTombstoneIds);
	return {
		purgedRecipeIds,
		expiredTombstoneIds,
		hasMore:
			recoverableExpired.length === batchSize ||
			expiredCandidates.length > expiredTombstoneIds.length
	};
};
