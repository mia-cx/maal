import * as Schema from 'effect/Schema';

export type InputSchema = Schema.Decoder<unknown>;

export const optionalHouseholdInput = { householdId: Schema.optional(Schema.String) };
export const stringArray = Schema.Array(Schema.String);
export const recordInput = Schema.Record(Schema.String, Schema.Unknown);

export const recipeFields = {
	title: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
	image: Schema.optional(Schema.String),
	sourceUrl: Schema.optional(Schema.String),
	sourceSiteName: Schema.optional(Schema.String),
	sourceAuthorName: Schema.optional(Schema.String),
	sourcePublisherName: Schema.optional(Schema.String),
	sourceIsBasedOnUrl: Schema.optional(Schema.String),
	prepTimeMinutes: Schema.optional(Schema.Number),
	cookTimeMinutes: Schema.optional(Schema.Number),
	yield: Schema.optional(Schema.Number),
	ingredients: Schema.optional(stringArray),
	instructions: Schema.optional(stringArray),
	userNotes: Schema.optional(Schema.String)
};

export const recipeShape = Schema.Struct(recipeFields);
export const createRecipeShape = Schema.Struct({ ...recipeFields, title: Schema.String });
export const emptyInput = Schema.Struct({});
