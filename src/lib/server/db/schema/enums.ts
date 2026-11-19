export const adoptionStatusValues = ['pending_review', 'accepted', 'rejected'] as const;
export const applianceValues = [
	'oven',
	'stovetop',
	'microwave',
	'air_fryer',
	'slow_cooker',
	'rice_cooker',
	'blender',
	'food_processor',
	'grill'
] as const;
export const applianceSourceValues = ['schema_org', 'instruction_heuristic', 'user'] as const;
export const classificationKindValues = ['category', 'cuisine', 'keyword', 'diet'] as const;
export const instructionEventKindValues = [
	'temperature',
	'duration',
	'appliance',
	'action'
] as const;
export const mediaKindValues = ['image', 'video'] as const;
export const nutrientValues = [
	'calories',
	'carbohydrate',
	'cholesterol',
	'fat',
	'fiber',
	'protein',
	'saturated_fat',
	'serving_size',
	'sodium',
	'sugar',
	'trans_fat',
	'unsaturated_fat',
	'other'
] as const;
export const mealStatusValues = ['planned', 'cooked', 'skipped'] as const;
export const mealVerdictValues = ['repeat', 'neutral', 'avoid'] as const;
export const foodPreferenceValues = ['favourite', 'like', 'dislike', 'disallowed'] as const;
export const householdRoleValues = ['admin', 'member', 'child'] as const;
export const aliasScopeValues = ['global', 'household', 'user'] as const;
export const householdAliasScopeValues = ['global', 'household'] as const;
export const trialClaimStateValues = ['reserved', 'started', 'rollback_pending'] as const;
export const stripeEventStateValues = ['pending', 'processing', 'processed', 'failed'] as const;
export const deletionRequestStateValues = [
	'requested',
	'cancelling',
	'refunding',
	'recoverable',
	'recovered',
	'purged',
	'failed'
] as const;
export const mcpPresetValues = ['read_only_planner', 'meal_planner', 'full_access'] as const;
export const mcpGrantModeValues = ['all', 'selected'] as const;
export const maalApiScopeValues = [
	'households:read',
	'households:write',
	'recipes:read',
	'recipes:write',
	'meals:read',
	'meals:write',
	'check_ins:read',
	'check_ins:write',
	'food_profile:read',
	'food_profile:write'
] as const;
export const syncAudienceKindValues = ['user', 'household'] as const;
export const syncOperationValues = ['upsert', 'delete', 'restore', 'purge'] as const;
