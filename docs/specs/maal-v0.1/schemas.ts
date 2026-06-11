// Draft API/MCP DTOs. The backend persistence model should be normalized with
// foreign keys/check constraints and should derive or cache rollups as needed.
export type ISODate = string;
export type ISODateTime = string;
export type ISOTime = string;
export type ISODuration = string;
export type HouseholdMealId = string;
export type ConfidenceScore = number;

export type WorkOsUserId = string;
export type WorkOsOrganizationId = string;
export type HouseholdId = WorkOsOrganizationId;

export type SchemaOrgRecipe = {
	'@context'?: 'https://schema.org' | string;
	'@type': 'Recipe' | string | string[];
	name: string;
	description?: string;
	image?: string | string[] | SchemaOrgImageObject | SchemaOrgImageObject[];
	author?:
		| string
		| SchemaOrgPerson
		| SchemaOrgOrganization
		| Array<string | SchemaOrgPerson | SchemaOrgOrganization>;
	url?: string;
	datePublished?: ISODate;
	dateModified?: ISODate;
	recipeYield?: string | string[];
	prepTime?: ISODuration;
	cookTime?: ISODuration;
	totalTime?: ISODuration;
	recipeIngredient?: string[];
	recipeInstructions?: Array<string | SchemaOrgHowToStep | SchemaOrgHowToSection>;
	nutrition?: SchemaOrgNutritionInformation;
	keywords?: string | string[];
	recipeCategory?: string | string[];
	recipeCuisine?: string | string[];
	aggregateRating?: unknown;
	video?: unknown;
};

export type SchemaOrgImageObject = {
	'@type'?: 'ImageObject';
	url?: string;
	contentUrl?: string;
	caption?: string;
};

export type SchemaOrgPerson = {
	'@type'?: 'Person';
	name: string;
	url?: string;
};

export type SchemaOrgOrganization = {
	'@type'?: 'Organization';
	name: string;
	url?: string;
};

export type SchemaOrgHowToStep = {
	'@type'?: 'HowToStep';
	name?: string;
	text: string;
	url?: string;
	image?: string | SchemaOrgImageObject;
};

export type SchemaOrgHowToSection = {
	'@type'?: 'HowToSection';
	name?: string;
	itemListElement: Array<string | SchemaOrgHowToStep>;
};

export type SchemaOrgNutritionInformation = {
	'@type'?: 'NutritionInformation';
	calories?: string;
	carbohydrateContent?: string;
	proteinContent?: string;
	fatContent?: string;
	fiberContent?: string;
	sugarContent?: string;
	sodiumContent?: string;
	servingSize?: string;
};

export type UserRecipe = {
	id: string;
	workosUserId: WorkOsUserId;
	savedFromHouseholdId?: HouseholdId;
	schemaOrgRecipe: SchemaOrgRecipe;
	source: RecipeSource;
	metadata: RecipeMetadata;
	ingredients: RecipeIngredient[];
	instructions: RecipeInstruction[];
	applianceRequirements?: ApplianceRequirement[];
	nutrition?: RecipeNutrition;
	createdAt: ISODateTime;
	updatedAt: ISODateTime;
};

export type RecipeMetadata = {
	familiarity: MealFamiliarity;
	latestVerdict?: MealFeedbackVerdict;
	timesCooked: number;
	lastCookedAt?: ISODateTime;
	averageActualMinutes?: number;
	sourceClaimedMinutes?: number;
	sourceQuality?: RecipeSourceQuality;
	userNotes?: string;
};

export type RecipeSourceQuality = {
	parseConfidence?: ConfidenceScore;
	ingredientConfidence?: ConfidenceScore;
	instructionConfidence?: ConfidenceScore;
	nutritionConfidence?: ConfidenceScore;
	timeRealismConfidence?: ConfidenceScore;
};

export type MealFamiliarity = 'safe' | 'exploration' | 'wildcard';

export type HouseholdMeal = {
	id: HouseholdMealId;
	householdId: HouseholdId;
	userRecipeId?: string;
	recipeSnapshot?: HouseholdMealRecipeSnapshot;
	ingredients?: RecipeIngredient[];
	instructions?: RecipeInstruction[];
	applianceRequirements?: ApplianceRequirement[];
	nutrition?: RecipeNutrition;
	includeInGroceryList: boolean;
	scheduledFor?: ISODateTime;
	date?: ISODate;
	slot?: MealSlot;
	status: HouseholdMealStatus;
	servingsPlanned: number;
	servingsCooked?: number;
	plannedCookWorkosUserId?: WorkOsUserId;
	ingredientPurchaseState?: IngredientPurchaseState;
	sortOrder?: number;
	lastConsideredAt?: ISODateTime;
	replacedByHouseholdMealId?: HouseholdMealId;
	replacementKind?: MealReplacementKind;
	notes?: string;
	createdAt: ISODateTime;
	updatedAt: ISODateTime;
};

export type HouseholdMealRecipeSnapshot = {
	schemaOrgRecipe: SchemaOrgRecipe;
	source: RecipeSource;
	metadata: RecipeMetadata;
	promotedToUserRecipeId?: string;
};

export type RecipeIngredient = {
	id?: string;
	lineIndex: number;
	originalText: string;
	parsedName?: string;
	quantity?: number;
	unit?: string;
	category?: GroceryCategory;
	optional?: boolean;
	confidence: ConfidenceScore;
};

export type RecipeInstruction = {
	id?: string;
	stepIndex: number;
	sectionName?: string;
	text: string;
	durationMinutes?: number;
	confidence?: ConfidenceScore;
};

export type ApplianceKind =
	| 'oven'
	| 'stovetop'
	| 'microwave'
	| 'air_fryer'
	| 'slow_cooker'
	| 'rice_cooker'
	| 'blender'
	| 'food_processor'
	| 'grill';

export type ApplianceRequirementSource = 'schema_org' | 'instruction_heuristic' | 'poke' | 'user';

export type ApplianceRequirement = {
	id?: string;
	appliance: ApplianceKind;
	required: boolean;
	source: ApplianceRequirementSource;
	confidence: ConfidenceScore;
	notes?: string;
};

export type RecipeNutrition = {
	calories?: number;
	proteinGrams?: number;
	carbsGrams?: number;
	fatGrams?: number;
	servingSize?: string;
	confidence?: ConfidenceScore;
};

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
export type HouseholdMealStatus =
	| 'planned'
	| 'cooked'
	| 'skipped'
	| 'postponed'
	| 'replaced'
	| 'archived';
export type MealReplacementKind = 'household_meal' | 'takeout' | 'external_meal';
export type CapacityMode = 'adventurous' | 'normal' | 'low' | 'survival';

export type IngredientPurchaseState =
	| 'none_needed'
	| 'not_purchased'
	| 'partially_purchased'
	| 'ready'
	| 'unknown';

export type HouseholdProfile = {
	householdId: HouseholdId;
	defaultServings: number;
	defaultCalendarView: CalendarViewPreference;
	preferredDinnerTime?: string;
	appliances?: HouseholdAppliance[];
	pantryStaples: PantryStaple[];
	createdAt: ISODateTime;
	updatedAt: ISODateTime;
};

export type HouseholdAppliance = {
	id?: string;
	appliance: ApplianceKind;
	available: boolean;
	notes?: string;
};

export type CalendarViewPreference = {
	durationDays: number;
	anchor: 'today' | 'week_start' | 'month_start';
};

export type UserCookingProfile = {
	workosUserId: WorkOsUserId;
	cookTimeCoefficient: number;
	preferredDinnerTime?: string;
	createdAt: ISODateTime;
	updatedAt: ISODateTime;
};

export type HardFoodRule = {
	id: string;
	workosUserId: WorkOsUserId;
	type: 'allergy' | 'diet_constraint';
	subject: string;
	notes?: string;
};

export type TastePreference = {
	id: string;
	workosUserId: WorkOsUserId;
	subject: string;
	subjectType: 'ingredient' | 'recipe' | 'cuisine' | 'texture' | 'tag';
	rating: TasteRating;
	notes?: string;
};

export type TasteRating = 'favourite' | 'like' | 'mostly_indifferent' | 'hate';

export type PantryStaple = {
	id: string;
	name: string;
	aliases?: string[];
	category?: GroceryCategory;
	defaultUnit?: string;
	notes?: string;
};

export type GroceryList = {
	id: string;
	householdId: HouseholdId;
	startsOn?: ISODate;
	endsOn?: ISODate;
	includedHouseholdMealIds?: HouseholdMealId[];
	items: GroceryItem[];
	assumedPantry: GroceryItem[];
	needsReview: GroceryItem[];
	createdAt: ISODateTime;
	updatedAt: ISODateTime;
};

export type GroceryItem = {
	id: string;
	displayName: string;
	category?: GroceryCategory;
	quantity?: GroceryQuantity;
	status: GroceryItemStatus;
	confidence: ConfidenceScore;
	perishable?: boolean;
	neededByHouseholdMealIds: HouseholdMealId[];
	originalLines: GrocerySourceLine[];
	stapleMatchId?: string;
	purchasedAt?: ISODateTime;
	notes?: string;
};

export type GroceryQuantity = {
	amount?: number;
	unit?: string;
	display: string;
};

export type GrocerySourceLine = {
	householdMealId: HouseholdMealId;
	userRecipeId?: string;
	recipeName?: string;
	ingredientLine: string;
};

export type GroceryItemStatus =
	| 'needed'
	| 'purchased'
	| 'assumed_pantry'
	| 'skipped'
	| 'needs_review';

export type GroceryCategory =
	| 'produce'
	| 'meat_seafood'
	| 'dairy_eggs'
	| 'bakery'
	| 'pantry'
	| 'spices'
	| 'oil_vinegar'
	| 'frozen'
	| 'household'
	| 'other';

export type MealCheckIn = MealCheckInBase &
	(
		| { householdMealId: HouseholdMealId; userRecipeId?: string }
		| { householdMealId?: HouseholdMealId; userRecipeId: string }
	);

export type MealCheckInBase = {
	id: string;
	plannedCookWorkosUserId?: WorkOsUserId;
	actualCookWorkosUserId?: WorkOsUserId;
	reportedByWorkosUserId: WorkOsUserId;
	actualMinutes?: number;
	claimedMinutes?: number;
	cookTimeRatio?: number;
	servingsCooked?: number;
	verdict?: MealFeedbackVerdict;
	reasons?: MealFeedbackReason[];
	notes?: string;
	createdAt: ISODateTime;
};

export type MealFeedbackVerdict = 'worth_repeating' | 'neutral' | 'never_again';

export type MealFeedbackReason =
	| 'taste'
	| 'effort'
	| 'cook_time'
	| 'cleanup'
	| 'cost'
	| 'ingredients'
	| 'portion_size'
	| 'instructions'
	| 'mood_fit';

export type MealFitVector = {
	constraintFit: 'allowed' | 'blocked';
	familiarityFit: number;
	preferenceFit: number;
	effortFit: number;
	timeFit: number;
	ingredientFit: number;
	freshnessFit: number;
	servingFit: number;
};

export type MealCandidate = {
	householdMealId?: HouseholdMealId;
	userRecipeId?: string;
	score: number;
	fit: MealFitVector;
	reasons: string[];
	warnings: string[];
	groceryDelta?: GroceryItem[];
};

export type UserDataExport = {
	exportedAt: ISODateTime;
	householdId: HouseholdId;
	profile: HouseholdProfile;
	userCookingProfile?: UserCookingProfile;
	hardRules: HardFoodRule[];
	tastePreferences: TastePreference[];
	userRecipes: UserRecipe[];
	householdMeals: HouseholdMeal[];
	groceryLists: GroceryList[];
	mealCheckIns: MealCheckIn[];
};
