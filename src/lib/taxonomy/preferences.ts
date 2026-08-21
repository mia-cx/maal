import { Schema } from 'effect';

import { FoodPreferenceValueSchema } from '$lib/domain/taxonomy/schema.js';

export type MassUnit = 'g' | 'kg' | 'oz' | 'lb';
export type VolumeUnit = 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'fl oz';

export interface UnitConversion {
	baseUnitId: string;
	toBaseFactor: number;
	toBaseOffset: number;
}

export interface UnitPreferences {
	preferredMassUnit?: MassUnit;
	preferredMassUnitLabel?: string;
	preferredMassUnitPluralLabel?: string;
	preferredVolumeUnit?: VolumeUnit;
	preferredVolumeUnitLabel?: string;
	preferredVolumeUnitPluralLabel?: string;
	preferredTemperatureUnit?: string;
	preferredTemperatureUnitLabel?: string;
	unitConversions?: Record<string, UnitConversion>;
	unitAliases?: Record<string, string>;
	unitLabelOverrides?: Record<string, string>;
	unitPluralLabelOverrides?: Record<string, string>;
	ingredientUnitOverrides?: Record<string, string>;
	ingredientUnitLabelOverrides?: Record<string, string>;
	ingredientUnitPluralLabelOverrides?: Record<string, string>;
	ingredientNameOverrides?: Record<string, string>;
}

export interface EffectiveTaxonomyPreferences {
	locale: string;
	localeFallbacks: readonly string[];
	unitPreferences: UnitPreferences;
	unitDisplay: Record<string, { unitId: string; alias: string; pluralAlias?: string }>;
	foodDisplay: Record<
		string,
		{ alias?: string; preferredMeasureUnitId?: string; preferredMeasureAlias?: string }
	>;
	foodPreferences: Record<
		string,
		{ preference: typeof FoodPreferenceValueSchema.Type; reason?: string }
	>;
}

const UnitConversionSchema = Schema.Struct({
	baseUnitId: Schema.String,
	toBaseFactor: Schema.Number,
	toBaseOffset: Schema.Number
});

const UnitPreferencesSchema = Schema.Struct({
	preferredMassUnit: Schema.optional(Schema.Literal('g', 'kg', 'oz', 'lb')),
	preferredMassUnitLabel: Schema.optional(Schema.String),
	preferredMassUnitPluralLabel: Schema.optional(Schema.String),
	preferredVolumeUnit: Schema.optional(Schema.Literal('ml', 'l', 'tsp', 'tbsp', 'cup', 'fl oz')),
	preferredVolumeUnitLabel: Schema.optional(Schema.String),
	preferredVolumeUnitPluralLabel: Schema.optional(Schema.String),
	preferredTemperatureUnit: Schema.optional(Schema.String),
	preferredTemperatureUnitLabel: Schema.optional(Schema.String),
	unitConversions: Schema.optional(
		Schema.Record({ key: Schema.String, value: UnitConversionSchema })
	),
	unitAliases: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	unitLabelOverrides: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
	unitPluralLabelOverrides: Schema.optional(
		Schema.Record({ key: Schema.String, value: Schema.String })
	),
	ingredientUnitOverrides: Schema.optional(
		Schema.Record({ key: Schema.String, value: Schema.String })
	),
	ingredientUnitLabelOverrides: Schema.optional(
		Schema.Record({ key: Schema.String, value: Schema.String })
	),
	ingredientUnitPluralLabelOverrides: Schema.optional(
		Schema.Record({ key: Schema.String, value: Schema.String })
	),
	ingredientNameOverrides: Schema.optional(
		Schema.Record({ key: Schema.String, value: Schema.String })
	)
});

export const EffectiveTaxonomyPreferencesSchema = Schema.Struct({
	locale: Schema.String,
	localeFallbacks: Schema.Array(Schema.String),
	unitPreferences: UnitPreferencesSchema,
	unitDisplay: Schema.Record({
		key: Schema.String,
		value: Schema.Struct({
			unitId: Schema.String,
			alias: Schema.String,
			pluralAlias: Schema.optional(Schema.String)
		})
	}),
	foodDisplay: Schema.Record({
		key: Schema.String,
		value: Schema.Struct({
			alias: Schema.optional(Schema.String),
			preferredMeasureUnitId: Schema.optional(Schema.String),
			preferredMeasureAlias: Schema.optional(Schema.String)
		})
	}),
	foodPreferences: Schema.Record({
		key: Schema.String,
		value: Schema.Struct({
			preference: FoodPreferenceValueSchema,
			reason: Schema.optional(Schema.String)
		})
	})
});

export const emptyTaxonomyPreferences = (locale = 'en-US'): EffectiveTaxonomyPreferences => ({
	locale,
	localeFallbacks: [locale],
	unitPreferences: {},
	unitDisplay: {},
	foodDisplay: {},
	foodPreferences: {}
});
