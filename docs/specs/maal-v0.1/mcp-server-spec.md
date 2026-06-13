# Maal MCP Server Spec

Status: draft for critical review

## Goal

Expose Maal meal planning as an authenticated MCP server so assistants can help users manage recipes, household plans, diet constraints, and check-ins without duplicating app business logic.

The MCP server must call existing Maal server/service functions. Route handlers and MCP tools should share the same underlying modules for authorization, validation, persistence, taxonomy/unit parsing, and meal/recipe mapping.

## Non-goals for v1

- No anonymous access.
- No cross-user recipe discovery outside authorized household/user scope.
- No MCP-only persistence paths.
- No model-specific prompts that hide tool behavior.
- No grocery or pantry tools in this spec; Maal does not have grocery rollups or pantry persistence yet.

## Authentication

MCP clients authenticate with a user-owned MCP access key. These are API keys in the technical sense, but user-facing copy should call them MCP keys.

### MCP key requirements

- MCP keys are owned by a WorkOS user.
- Each key grants a maximum API capability set, similar to Vesta/Erato's global `scopes` array.
- Each key also has a household allow-list:
  - one household
  - multiple explicit households
  - all current/future households for that user
- The key's scopes are not the final authorization decision. Every tool call must also verify the owning user's active WorkOS organization membership and role permissions for the requested household.
- Keys can be revoked.
- Keys should have metadata:
  - key id
  - user id
  - household scope
  - maximum API scopes
  - created at
  - last used at
  - optional label, e.g. `Poke on Mia's laptop`
- Store only a hash of the secret token.
- Return the raw secret exactly once at creation.

### User settings creation flow

Add an MCP keys section to user settings before exposing the MCP server. The flow should let a signed-in user:

1. Create a key with a required label, household scope, and coarse scopes.
2. Pick one household, multiple households, or all current/future households.
3. Start from presets such as read-only planner, meal planner, and full access rather than forcing users to understand every scope.
4. See the raw key exactly once with a copy button and clear “store this now” warning.
5. List existing keys with label, household scope, scopes/preset, created at, last used at, expiry, and revoked state.
6. Revoke a key without exposing its raw secret again.

### Storage proposal

Use Cloudflare KV for MCP key lookup/provisioning.

Suggested shape:

```ts
type MaalApiScope =
	| 'households:read'
	| 'households:write'
	| 'recipes:read'
	| 'recipes:write'
	| 'meals:read'
	| 'meals:write'
	| 'check_ins:read'
	| 'check_ins:write'
	| 'food_profile:read'
	| 'food_profile:write';

type McpKeyRecord = {
	id: string;
	userId: string;
	secretHash: string;
	householdScope: { kind: 'all' } | { kind: 'households'; householdIds: string[] };
	scopes: MaalApiScope[];
	label?: string;
	createdAt: string;
	expiresAt?: string;
	revokedAt?: string;
	lastUsedAt?: string;
};
```

Lookup:

- Store the full key hash directly: `mk:<sha256(rawKey)> -> McpKeyRecord`
- Do not maintain a prefix index unless lookup performance or UX later proves it is needed.

Token format suggestion:

```txt
mk_<randomSecret>
```

Server flow:

1. Read bearer token from `Authorization: Bearer ...`.
2. Require it to start with `mk_`.
3. Hash the presented key.
4. Load `mk:<sha256(rawKey)>` from KV.
5. Reject missing or revoked keys.
6. Resolve key household allow-list.
7. For each tool call, require the requested household to be in the key's household allow-list.
8. Require the key's global scopes to include the tool's API scope.
9. Load the user's active WorkOS organization membership/role for the requested household and require the corresponding role permission.

If the key is scoped to more than one household or all households, expose `list_user_households`. If scoped to exactly one household, tools may default to that household when `householdId` is omitted.

## Household scoping and effective permissions

Every tool that reads or writes household data must accept `householdId` unless the MCP key has exactly one household in scope.

Authorization is the intersection of three checks:

1. **MCP key household allow-list**: the requested household is allowed by the key.
2. **MCP key scope**: the key grants the tool's coarse API scope, e.g. `meals:read` or `meals:write`.
3. **WorkOS household role permission**: the key owner is still an active member of that household organization and their WorkOS role grants the mapped Maal permission.

This lets a user mint a narrowly scoped key, and also lets household role changes immediately reduce API access without rotating every key. For example, a child role can grant `meals:read` while withholding `meals:write`, so their key can list meals but cannot create or edit them even if the key's own scopes are broader.

Suggested permission mapping:

| MCP/API action                              | MCP key scope        | WorkOS role permission         |
| ------------------------------------------- | -------------------- | ------------------------------ |
| List households                             | `households:read`    | active organization membership |
| List/get recipes                            | `recipes:read`       | `recipes:read`                 |
| Create/update/delete recipes                | `recipes:write`      | `recipes:write`                |
| List/get meal plan                          | `meals:read`         | `meals:read`                   |
| Create/update/delete meals                  | `meals:write`        | `meals:write`                  |
| List/get check-ins                          | `check_ins:read`     | `check_ins:read`               |
| Create/update/delete check-ins              | `check_ins:write`    | `check_ins:write`              |
| List/get diet/food profile                  | `food_profile:read`  | `food_profile:read`            |
| Create/update/delete diet/food profile data | `food_profile:write` | `food_profile:write`           |

Tool shape and permission scopes are intentionally different levels of granularity. MCP should expose explicit operation tools where useful — list, get/read, create, update, delete/archive — while scopes stay coarse. `*:read` covers list and get/read tools. `*:write` covers create, update, delete, archive, skip, restore, and other mutating tools.

Errors must be explicit:

- `household_required`: key has multiple households; pass `householdId`.
- `household_forbidden`: key is not scoped to that household or the owner is no longer an active member.
- `insufficient_scope`: key lacks the required MCP key scope.
- `insufficient_role_permission`: key owner lacks the required WorkOS role permission in that household.
- `not_found`: resource is absent or outside scope.

## Data model adjustments before MCP v1

### Meal status

Add `skipped` to `household_meals.status`.

```ts
type HouseholdMealStatus = 'planned' | 'cooked' | 'skipped';
```

Reason: a skipped plan should remain visible in history/dashboard instead of being deleted or represented as still planned.

### Cook assignment

Add/complete UI support for assigning the planned cook.

- Meal sheet gets a `Cook` dropdown.
- Options are active household organization members.
- Saves to `household_meals.planned_cook_workos_user_id`.
- Default remains the user who first planned/created the meal.
- Later enhancement: richer cook assignment flow from cards/context menu.

Check-in cook-time entry should remain limited to the planned cook.

## Tool design principles

- Tool names use `maal_` prefix.
- Prefer filtered list tools + focused CRUD tools.
- Return structured JSON with concise human-readable summaries.
- Include stable ids in every response.
- Include `householdId` and resource ids in mutation responses.
- All mutation tools are idempotent where practical.
- Do not return huge recipe bodies by default; use `includeDetails` flags.

## Tool surface v1

### `maal_list_user_households`

Only exposed/needed when the MCP key can access more than one household.

Inputs: none.

Returns:

```ts
type HouseholdSummary = {
	id: string;
	name: string;
};
```

### `maal_list_user_recipes`

Lists recipes saved by the authenticated user.

Inputs:

```ts
type ListUserRecipesInput = {
	householdId?: string;
	query?: string;
	familiarity?: {
		minTimesCooked?: number;
		maxTimesCooked?: number;
		lastCookedAfter?: string;
		lastCookedBefore?: string;
	};
	rating?: {
		verdicts?: Array<'repeat' | 'neutral' | 'avoid'>;
		minReviews?: number;
		maxReviews?: number;
	};
	cookTimeMinutes?: { min?: number; max?: number };
	tags?: string[];
	includeArchived?: boolean;
	includeDetails?: boolean;
	limit?: number;
	cursor?: string;
};
```

Notes:

- “frecency range” should be modeled as explicit filters where possible, plus default ordering by existing recipe relevance/frecency ranking.
- Rating names in UI may be “worth repeating / indifferent / never again”; persisted verdicts are `repeat | neutral | avoid`.

### `maal_create_user_recipe`

Creates a user recipe from either a URL import or explicit recipe fields.

Inputs:

```ts
type CreateUserRecipeInput = {
	householdId?: string;
	sourceUrl?: string;
	recipe?: {
		title: string;
		description?: string;
		imageUrl?: string;
		cookTimeMinutes?: number;
		yield?: number;
		ingredients?: string[];
		instructions?: string[];
	};
};
```

### `maal_get_user_recipe`

Gets one recipe with full details.

Inputs:

```ts
type GetUserRecipeInput = {
	householdId?: string;
	recipeId: string;
};
```

### `maal_update_user_recipe`

Updates editable user recipe fields.

Inputs:

```ts
type UpdateUserRecipeInput = {
	householdId?: string;
	recipeId: string;
	patch: Partial<{
		title: string;
		description: string;
		imageUrl: string;
		cookTimeMinutes: number;
		yield: number;
		ingredients: string[];
		instructions: string[];
	}>;
};
```

### `maal_delete_user_recipe`

Archives or permanently deletes a user recipe.

Inputs:

```ts
type DeleteUserRecipeInput = {
	householdId?: string;
	recipeId: string;
	mode: 'archive' | 'permanent';
};
```

Permanent delete must be marked destructive.

### `maal_list_household_plan`

Lists household meals for a date range.

Inputs:

```ts
type ListHouseholdPlanInput = {
	householdId?: string;
	startDate: string; // YYYY-MM-DD
	endDate: string; // YYYY-MM-DD
	cookUserId?: string;
	status?: Array<'planned' | 'cooked' | 'skipped'>;
	includeFloating?: boolean; // undated meal pool; default true
	includeDetails?: boolean;
	limit?: number;
	cursor?: string;
};
```

Returns planned dated meals plus floating meals when requested.

### `maal_create_household_meal`

Creates a household meal, optionally from a user recipe.

Inputs:

```ts
type CreateHouseholdMealInput = {
	householdId?: string;
	userRecipeId?: string;
	date?: string;
	time?: string;
	sortOrder?: number;
	plannedCookUserId?: string;
	servingsPlanned?: number;
	customMeal?: {
		title: string;
		description?: string;
		imageUrl?: string;
		cookTimeMinutes?: number;
		ingredients?: string[];
		instructions?: string[];
	};
};
```

Validation:

- `plannedCookUserId` must be an active member of the household.
- If omitted, default to authenticated MCP key owner.

### `maal_create_household_meals`

Bulk-creates household meals so assistants can schedule a week or plan batch without issuing one tool call per meal.

Inputs:

```ts
type CreateHouseholdMealsInput = {
	householdId?: string;
	meals: Array<Omit<CreateHouseholdMealInput, 'householdId'>>;
	mode?: 'all_or_nothing' | 'best_effort'; // default all_or_nothing
};
```

Validation:

- Requires `meals:write` and the same WorkOS role permission as `maal_create_household_meal`.
- `meals` length must be between 1 and 50.
- Each item uses the same validation/defaulting rules as `maal_create_household_meal`.
- `all_or_nothing` should reject the whole batch if any item is invalid.
- `best_effort` should create valid meals and return per-item errors for invalid meals.

Returns:

```ts
type CreateHouseholdMealsResult = {
	created: HouseholdMeal[];
	errors?: Array<{
		index: number;
		code: string;
		message: string;
	}>;
};
```

### `maal_get_household_meal`

Gets one household meal with recipe snapshot, ingredients, instructions, planned cook, status, and latest check-ins.

Inputs:

```ts
type GetHouseholdMealInput = {
	householdId?: string;
	mealId: string;
};
```

### `maal_update_household_meal`

Updates scheduling, cook assignment, status, servings, or custom meal fields.

Inputs:

```ts
type UpdateHouseholdMealInput = {
	householdId?: string;
	mealId: string;
	patch: Partial<{
		date: string | null;
		time: string | null;
		sortOrder: number | null;
		plannedCookUserId: string | null;
		servingsPlanned: number;
		status: 'planned' | 'cooked' | 'skipped';
		title: string;
		description: string;
		cookTimeMinutes: number;
		ingredients: string[];
		instructions: string[];
	}>;
};
```

### `maal_delete_household_meal`

Deletes a household meal.

Inputs:

```ts
type DeleteHouseholdMealInput = {
	householdId?: string;
	mealId: string;
};
```

Destructive.

### `maal_create_meal_check_in`

Creates or updates the current user’s check-in for a meal.

Inputs:

```ts
type CreateMealCheckInInput = {
	householdId?: string;
	mealId: string;
	status: 'cooked' | 'skipped';
	verdict?: 'repeat' | 'neutral' | 'avoid';
	cookTimeMinutes?: number;
	notes?: string;
};
```

Rules:

- `status = cooked` updates meal status to `cooked`.
- `status = skipped` updates meal status to `skipped`.
- `cookTimeMinutes` is accepted only when the API-key owner is the meal’s planned cook.
- `verdict` may be optional for skipped meals.

### `maal_update_meal_check_in`

Updates an existing check-in.

Inputs:

```ts
type UpdateMealCheckInInput = {
	householdId?: string;
	checkInId: string;
	patch: Partial<{
		status: 'cooked' | 'skipped';
		verdict: 'repeat' | 'neutral' | 'avoid';
		cookTimeMinutes: number | null;
		notes: string | null;
	}>;
};
```

### `maal_delete_meal_check_in`

Deletes a check-in and recalculates derived meal/recipe state if needed.

Inputs:

```ts
type DeleteMealCheckInInput = {
	householdId?: string;
	checkInId: string;
};
```

### `maal_list_household_diet`

Better name candidates:

- `maal_get_household_food_profile`
- `maal_list_household_food_constraints`
- `maal_get_household_diet_profile`

Recommended: `maal_get_household_food_profile`.

Purpose: return allergies, dietary constraints, dislikes, ingredient preferences, and household-specific food/unit preferences.

Inputs:

```ts
type GetHouseholdFoodProfileInput = {
	householdId?: string;
};
```

Returns:

```ts
type HouseholdFoodProfile = {
	allergies: string[];
	dietaryConstraints: string[];
	dislikedIngredients: string[];
	preferredIngredients: string[];
	ingredientDisplayOverrides: Array<{
		foodId: string;
		alias?: string;
		preferredMeasureUnitId?: string;
		preferredMeasureAlias?: string;
	}>;
	unitDisplayOverrides: Array<{
		baseUnitId: string;
		unitId: string;
		alias: string;
		pluralAlias?: string;
	}>;
};
```

If Maal does not yet persist all diet/profile fields, the tool should return the available fields and a `notImplemented` list rather than inventing data.

## Shared service modules needed

Before implementing MCP tools, extract route logic into modules:

- `src/lib/server/services/recipes.ts`
  - list/search/create/import/update/archive/delete user recipes
- `src/lib/server/services/meal-plan.ts`
  - list/create/update/delete household meals
  - move/schedule/floating meal operations
- `src/lib/server/services/check-ins.ts`
  - create/update/delete check-ins
  - meal status transitions
- `src/lib/server/services/households.ts`
  - list user households
  - list active household members
  - validate household membership/scope
- `src/lib/server/services/food-profile.ts`
  - household diet/food profile reads
- `src/lib/server/auth/mcp-keys.ts`
  - create/revoke/verify MCP keys
  - KV integration

SvelteKit routes and MCP tools should both depend on these modules.

## MCP transport

Recommended first implementation:

- Cloudflare-hosted Streamable HTTP MCP endpoint.
- Stateless JSON responses.
- Bearer MCP key auth.

Possible endpoint:

```txt
/mcp
```

Keep stdio/local MCP as a later dev convenience, not the primary integration path.

## Error response conventions

Every tool error should include:

```ts
type ToolError = {
	code: string;
	message: string;
	suggestion?: string;
};
```

Examples:

- `household_required`: “This MCP key can access multiple households. Pass householdId.”
- `planned_cook_required`: “Only the planned cook can report cook time. Omit cookTimeMinutes or change plannedCookUserId.”
- `recipe_not_found`: “Recipe was not found in this user’s menu.”
- `date_range_too_large`: “Use a date range of 180 days or less.”

## Open questions for review

1. Should MCP key write scopes stay coarse for all mutations, or should any destructive operations require extra confirmation/scope?
2. Should `skipped` require a check-in row, or can meal status be set directly?
3. Should `verdict` be required for cooked check-ins?
4. Should assistants be able to permanently delete recipes/meals, or only archive/remove from plan?
5. What is the persisted source of truth for household diet/allergy constraints?
6. Do MCP keys inherit newly joined households when scoped to `all`, or only households visible at key creation time?
7. Should `list_user_recipes` expose raw ingredients/instructions by default, or require `includeDetails`?
