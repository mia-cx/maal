// Draft API/MCP DTOs. The backend persistence model should be normalized with
// foreign keys/check constraints and should derive or cache rollups as needed.
export type ISODate = string;
export type ISODateTime = string;
export type ISOTime = string;
export type ISODuration = string;
export type UserRecipeId = string;
export type HouseholdMealId = string;
export type IngredientId = string;
export type UnitId = string;
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
	suitableForDiet?: string | string[];
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
	saturatedFatContent?: string;
	sugarContent?: string;
	sodiumContent?: string;
	cholesterolContent?: string;
	transFatContent?: string;
	unsaturatedFatContent?: string;
	servingSize?: string;
};

export type UserRecipe = {
	id: string;
	workosUserId: WorkOsUserId;
	savedFromHouseholdId?: HouseholdId;
	title: string;
	description?: string;
	imageUrl?: string;
	prepTimeMinutes?: number;
	cookTimeMinutes?: number;
	totalTimeMinutes?: number;
	servings?: number;
	sourceYieldText?: string;
	sourceDatePublished?: ISODate;
	sourceDateModified?: ISODate;
	sourceLanguage?: string;
	sourceRatingValue?: number;
	sourceRatingCount?: number;
	sourceReviewCount?: number;
	source: RecipeSource;
	metadata: RecipeMetadata;
	ingredients: RecipeIngredient[];
	instructions: RecipeInstruction[];
	classifications?: RecipeClassification[];
	media?: RecipeMedia[];
	applianceRequirements?: ApplianceRequirement[];
	nutritionFacts?: NutritionFact[];
	createdAt: ISODateTime;
	updatedAt: ISODateTime;
};

export type RecipeMetadata = {
	sourceClaimedMinutes?: number;
	sourceQuality?: RecipeSourceQuality;
	userNotes?: string;
};

export type RecipeSourceQuality = {
	parseConfidence?: ConfidenceScore;
	ingredientConfidence?: ConfidenceScore;
	instructionConfidence?: ConfidenceScore;
	nutritionConfidence?: ConfidenceScore;
};

export type MealFamiliarity = 'safe' | 'exploration' | 'wildcard';

export type HouseholdMeal = {
	id: HouseholdMealId;
	householdId: HouseholdId;
	userRecipeId?: string;
	title: string;
	description?: string;
	imageUrl?: string;
	prepTimeMinutes?: number;
	cookTimeMinutes?: number;
	baseServings: number;
	sourceYieldText?: string;
	sourceDatePublished?: ISODate;
	sourceDateModified?: ISODate;
	sourceLanguage?: string;
	sourceRatingValue?: number;
	sourceRatingCount?: number;
	sourceReviewCount?: number;
	ingredients?: RecipeIngredient[];
	instructions?: RecipeInstruction[];
	classifications?: RecipeClassification[];
	media?: RecipeMedia[];
	applianceRequirements?: ApplianceRequirement[];
	nutritionFacts?: NutritionFact[];
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

export type RecipeIngredient = {
	id?: string;
	lineIndex: number;
	originalText: string;
	sourceAmountText?: string;
	sourceIngredientLabel: string;
	baseQuantity?: number;
	baseUnit?: CanonicalUnitKey;
	ingredientId?: IngredientId;
	groceryRollupIngredientId?: IngredientId;
	displayLabelOverride?: string;
	displayUnitOverride?: UnitId;
	category?: GroceryCategory;
	optional?: boolean;
	confidence: ConfidenceScore;
};

export type CanonicalUnitKey = string;

export type RecipeInstruction = {
	id?: string;
	stepIndex: number;
	sectionName?: string;
	text: string;
	durationMinutes?: number;
	confidence?: ConfidenceScore;
};

export type RecipeClassification = {
	id?: string;
	kind: 'category' | 'cuisine' | 'keyword' | 'diet';
	value: string;
	normalizedValue: string;
	schemaOrgValue?: string;
	locale?: string;
	confidence: ConfidenceScore;
};

export type RecipeMedia = {
	id?: string;
	kind: 'image' | 'video';
	position: number;
	url?: string;
	contentUrl?: string;
	embedUrl?: string;
	thumbnailUrl?: string;
	name?: string;
	caption?: string;
};

export type NutritionFact = {
	id?: string;
	nutrient: NutritionNutrient;
	schemaOrgProperty: string;
	originalText: string;
	amount?: number;
	unit?: string;
	baseAmount?: number;
	baseUnit?: string;
	locale?: string;
	confidence: ConfidenceScore;
};

export type NutritionNutrient =
	| 'calories'
	| 'carbohydrate'
	| 'cholesterol'
	| 'fat'
	| 'fiber'
	| 'protein'
	| 'saturated_fat'
	| 'serving_size'
	| 'sodium'
	| 'sugar'
	| 'trans_fat'
	| 'unsaturated_fat'
	| 'other';

export type MealReview = {
	id: string;
	householdId: HouseholdId;
	householdMealId: HouseholdMealId;
	userRecipeId?: UserRecipeId;
	workosUserId: WorkOsUserId;
	rating?: number;
	verdict?: MealFeedbackVerdict;
	title?: string;
	body?: string;
	createdAt: ISODateTime;
	updatedAt: ISODateTime;
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
