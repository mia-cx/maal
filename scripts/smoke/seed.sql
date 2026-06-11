-- Smoke/perf fixture for local D1.
-- Auth with cookie/header: maal_smoke_auth=1 or x-maal-smoke-auth: 1
-- User: user_smoke_maal, household: org_smoke_kitchen

INSERT OR IGNORE INTO household_profiles (
	household_id,
	default_servings,
	default_calendar_duration_days,
	default_calendar_anchor,
	preferred_dinner_time
) VALUES ('org_smoke_kitchen', 4, 7, 'today', '18:30');

WITH RECURSIVE recipe_numbers(n) AS (
	SELECT 1
	UNION ALL
	SELECT n + 1 FROM recipe_numbers WHERE n < 80
)
INSERT OR IGNORE INTO user_recipes (
	id,
	workos_user_id,
	saved_from_household_id,
	schema_org_recipe_json,
	raw_json_ld,
	source_url,
	source_site_name,
	source_author_name,
	source_claimed_minutes,
	parse_confidence,
	ingredient_confidence,
	instruction_confidence,
	time_realism_confidence
)
SELECT
	printf('recipe_smoke_%03d', n),
	'user_smoke_maal',
	'org_smoke_kitchen',
	json_object(
		'@context', 'https://schema.org',
		'@type', 'Recipe',
		'name', printf('Smoke Recipe %03d', n),
		'description', 'Seeded recipe for meal plan smoke tests and perf benches.',
		'image', printf('https://picsum.photos/seed/maal-smoke-%03d/640/320', n),
		'cookTime', printf('PT%dM', 15 + (n % 70)),
		'recipeYield', 4,
		'recipeIngredient', json_array('1 cup rice', '2 eggs', '1 tbsp oil'),
		'recipeInstructions', json_array(
			json_object('@type', 'HowToStep', 'position', 1, 'text', 'Prep ingredients.'),
			json_object('@type', 'HowToStep', 'position', 2, 'text', 'Cook until done.')
		)
	),
	null,
	printf('https://example.test/recipes/smoke-%03d', n),
	'Smoke Recipes',
	'Maal Fixtures',
	15 + (n % 70),
	1,
	1,
	1,
	0.8
FROM recipe_numbers;

WITH RECURSIVE recipe_numbers(n) AS (
	SELECT 1
	UNION ALL
	SELECT n + 1 FROM recipe_numbers WHERE n < 80
)
INSERT OR IGNORE INTO user_recipe_ingredients (
	id,
	user_recipe_id,
	line_index,
	original_text,
	parsed_name,
	quantity,
	unit,
	confidence
)
SELECT
	printf('ingredient_smoke_%03d_%d', n, ingredient.line_index),
	printf('recipe_smoke_%03d', n),
	ingredient.line_index,
	ingredient.original_text,
	ingredient.parsed_name,
	ingredient.quantity,
	ingredient.unit,
	1
FROM recipe_numbers
JOIN (
	SELECT 0 AS line_index, '1 cup rice' AS original_text, 'rice' AS parsed_name, 1 AS quantity, 'cup' AS unit
	UNION ALL SELECT 1, '2 eggs', 'eggs', 2, null
	UNION ALL SELECT 2, '1 tbsp oil', 'oil', 1, 'tbsp'
) ingredient;

WITH RECURSIVE recipe_numbers(n) AS (
	SELECT 1
	UNION ALL
	SELECT n + 1 FROM recipe_numbers WHERE n < 80
)
INSERT OR IGNORE INTO user_recipe_instructions (
	id,
	user_recipe_id,
	step_index,
	text,
	confidence
)
SELECT
	printf('instruction_smoke_%03d_%d', n, instruction.step_index),
	printf('recipe_smoke_%03d', n),
	instruction.step_index,
	instruction.text,
	1
FROM recipe_numbers
JOIN (
	SELECT 0 AS step_index, 'Prep ingredients.' AS text
	UNION ALL SELECT 1, 'Cook until done.'
) instruction;

WITH RECURSIVE meal_numbers(n) AS (
	SELECT 0
	UNION ALL
	SELECT n + 1 FROM meal_numbers WHERE n < 729
)
INSERT OR IGNORE INTO household_meals (
	id,
	household_id,
	user_recipe_id,
	recipe_snapshot_json,
	scheduled_for,
	date,
	status,
	servings_planned,
	sort_order
)
SELECT
	printf('meal_smoke_%03d', n),
	'org_smoke_kitchen',
	printf('recipe_smoke_%03d', (n % 80) + 1),
	null,
	printf('%sT18:%02d:00', date('now', printf('%+d days', n - 365)), (n % 4) * 10),
	date('now', printf('%+d days', n - 365)),
	'planned',
	4,
	(n % 5) * 1000
FROM meal_numbers;
