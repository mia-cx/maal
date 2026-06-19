-- Smoke/perf fixture for local D1.
-- Auth with cookie/header: maal_smoke_auth=1 or x-maal-smoke-auth: 1
-- User: user_smoke_maal, household: org_smoke_kitchen

INSERT OR IGNORE INTO users (workos_user_id)
VALUES ('user_smoke_maal');

INSERT OR IGNORE INTO households (
	household_id,
	created_by_user_id,
	default_planned_yield,
	locale,
	timezone,
	week_starts_on,
	preferred_dinner_time
) VALUES ('org_smoke_kitchen', 'user_smoke_maal', 4, 'en-US', 'UTC', 1, '18:30');

INSERT OR REPLACE INTO billing_subscriptions (
	household_id,
	stripe_customer_id,
	subscriber_user_id,
	stripe_subscription_id,
	stripe_price_id,
	status,
	current_period_end
) VALUES (
	'org_smoke_kitchen',
	'cus_smoke_maal',
	'user_smoke_maal',
	'sub_smoke_maal',
	'price_smoke_maal',
	'active',
	datetime('now', '+30 days')
);

WITH RECURSIVE recipe_numbers(n) AS (
	SELECT 1
	UNION ALL
	SELECT n + 1 FROM recipe_numbers WHERE n < 80
)
INSERT OR IGNORE INTO user_recipes (
	id,
	workos_user_id,
	saved_from_household_id,
	title,
	description,
	image_url,
	cook_time_minutes,
	yield,
	source_url,
	source_site_name,
	source_author_name,
	source_claimed_minutes,
	parse_confidence,
	ingredient_confidence,
	instruction_confidence,
	nutrition_confidence
)
SELECT
	printf('recipe_smoke_%03d', n),
	'user_smoke_maal',
	'org_smoke_kitchen',
	printf('Smoke Recipe %03d', n),
	'Seeded recipe for meal plan smoke tests and perf benches.',
	printf('https://picsum.photos/seed/maal-smoke-%03d/640/320', n),
	15 + (n % 70),
	4,
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
	source_amount_text,
	source_quantity,
	source_unit_label,
	source_food_label,
	confidence
)
SELECT
	printf('ingredient_smoke_%03d_%d', n, ingredient.line_index),
	printf('recipe_smoke_%03d', n),
	ingredient.line_index,
	ingredient.original_text,
	ingredient.amount_text,
	ingredient.quantity,
	ingredient.unit_label,
	ingredient.food_label,
	1
FROM recipe_numbers
JOIN (
	SELECT 0 AS line_index, '1 cup rice' AS original_text, '1' AS amount_text, 1 AS quantity, 'cup' AS unit_label, 'rice' AS food_label
	UNION ALL SELECT 1, '2 eggs', '2', 2, null, 'eggs'
	UNION ALL SELECT 2, '1 tbsp oil', '1', 1, 'tbsp', 'oil'
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
	title,
	description,
	image_url,
	date,
	time,
	status,
	cook_time_minutes,
	yield,
	planned_yield,
	sort_order,
	source_url,
	source_site_name,
	source_author_name,
	source_claimed_minutes,
	parse_confidence,
	ingredient_confidence,
	instruction_confidence,
	nutrition_confidence
)
SELECT
	printf('meal_smoke_%03d', n),
	'org_smoke_kitchen',
	printf('Smoke Recipe %03d', (n % 80) + 1),
	'Seeded meal for meal plan smoke tests and perf benches.',
	printf('https://picsum.photos/seed/maal-smoke-%03d/640/320', (n % 80) + 1),
	date('now', printf('%+d days', n - 365)),
	printf('18:%02d', (n % 4) * 10),
	'planned',
	15 + (n % 70),
	4,
	4,
	(n % 5) * 1000,
	printf('https://example.test/recipes/smoke-%03d', (n % 80) + 1),
	'Smoke Recipes',
	'Maal Fixtures',
	15 + (n % 70),
	1,
	1,
	1,
	0.8
FROM meal_numbers;

WITH RECURSIVE meal_numbers(n) AS (
	SELECT 0
	UNION ALL
	SELECT n + 1 FROM meal_numbers WHERE n < 729
)
INSERT OR IGNORE INTO household_meal_user_recipes (
	id,
	household_meal_id,
	user_recipe_id
)
SELECT
	printf('meal_recipe_link_smoke_%03d', n),
	printf('meal_smoke_%03d', n),
	printf('recipe_smoke_%03d', (n % 80) + 1)
FROM meal_numbers;

WITH RECURSIVE meal_numbers(n) AS (
	SELECT 0
	UNION ALL
	SELECT n + 1 FROM meal_numbers WHERE n < 729
)
INSERT OR IGNORE INTO household_meal_ingredients (
	id,
	household_meal_id,
	line_index,
	original_text,
	source_amount_text,
	source_quantity,
	source_unit_label,
	source_food_label,
	confidence
)
SELECT
	printf('meal_ingredient_smoke_%03d_%d', n, ingredient.line_index),
	printf('meal_smoke_%03d', n),
	ingredient.line_index,
	ingredient.original_text,
	ingredient.amount_text,
	ingredient.quantity,
	ingredient.unit_label,
	ingredient.food_label,
	1
FROM meal_numbers
JOIN (
	SELECT 0 AS line_index, '1 cup rice' AS original_text, '1' AS amount_text, 1 AS quantity, 'cup' AS unit_label, 'rice' AS food_label
	UNION ALL SELECT 1, '2 eggs', '2', 2, null, 'eggs'
	UNION ALL SELECT 2, '1 tbsp oil', '1', 1, 'tbsp', 'oil'
) ingredient;

WITH RECURSIVE meal_numbers(n) AS (
	SELECT 0
	UNION ALL
	SELECT n + 1 FROM meal_numbers WHERE n < 729
)
INSERT OR IGNORE INTO household_meal_instructions (
	id,
	household_meal_id,
	step_index,
	text,
	confidence
)
SELECT
	printf('meal_instruction_smoke_%03d_%d', n, instruction.step_index),
	printf('meal_smoke_%03d', n),
	instruction.step_index,
	instruction.text,
	1
FROM meal_numbers
JOIN (
	SELECT 0 AS step_index, 'Prep ingredients.' AS text
	UNION ALL SELECT 1, 'Cook until done.'
) instruction;
