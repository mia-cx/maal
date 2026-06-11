CREATE TABLE `food_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_name` text NOT NULL,
	`type` text NOT NULL,
	`parent_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_entities_canonical_name_unique` ON `food_entities` (`canonical_name`);--> statement-breakpoint
CREATE INDEX `food_entities_parent_id_idx` ON `food_entities` (`parent_id`);--> statement-breakpoint
CREATE TABLE `food_entity_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`food_entity_id` text NOT NULL,
	`alias` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`food_entity_id`) REFERENCES `food_entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_entity_aliases_alias_unique` ON `food_entity_aliases` (`alias`);--> statement-breakpoint
CREATE INDEX `food_entity_aliases_food_entity_id_idx` ON `food_entity_aliases` (`food_entity_id`);--> statement-breakpoint
CREATE TABLE `hard_food_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`type` text NOT NULL,
	`food_entity_id` text,
	`raw_subject` text,
	`severity` text DEFAULT 'block' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`food_entity_id`) REFERENCES `food_entities`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "hard_food_rules_subject_check" CHECK("hard_food_rules"."food_entity_id" IS NOT NULL OR "hard_food_rules"."raw_subject" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `hard_food_rules_workos_user_id_idx` ON `hard_food_rules` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `hard_food_rules_food_entity_id_idx` ON `hard_food_rules` (`food_entity_id`);--> statement-breakpoint
CREATE TABLE `pantry_staples` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`food_entity_id` text,
	`name` text NOT NULL,
	`aliases_json` text DEFAULT '[]' NOT NULL,
	`category` text,
	`default_unit` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`food_entity_id`) REFERENCES `food_entities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pantry_staples_household_id_idx` ON `pantry_staples` (`household_id`);--> statement-breakpoint
CREATE INDEX `pantry_staples_food_entity_id_idx` ON `pantry_staples` (`food_entity_id`);--> statement-breakpoint
CREATE TABLE `taste_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`food_entity_id` text,
	`raw_subject` text,
	`subject_type` text NOT NULL,
	`rating` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`food_entity_id`) REFERENCES `food_entities`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "taste_preferences_subject_check" CHECK("taste_preferences"."food_entity_id" IS NOT NULL OR "taste_preferences"."raw_subject" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `taste_preferences_workos_user_id_idx` ON `taste_preferences` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `taste_preferences_food_entity_id_idx` ON `taste_preferences` (`food_entity_id`);--> statement-breakpoint
CREATE TABLE `household_meal_appliance_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`appliance` text NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'instruction_heuristic' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_appliance_requirements_meal_appliance_unique` ON `household_meal_appliance_requirements` (`household_meal_id`,`appliance`);--> statement-breakpoint
CREATE INDEX `household_meal_appliance_requirements_household_meal_id_idx` ON `household_meal_appliance_requirements` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `household_meal_appliance_requirements_appliance_idx` ON `household_meal_appliance_requirements` (`appliance`);--> statement-breakpoint
CREATE TABLE `household_meal_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`line_index` integer NOT NULL,
	`original_text` text NOT NULL,
	`parsed_name` text,
	`food_entity_id` text,
	`quantity` real,
	`unit` text,
	`category` text,
	`optional` integer DEFAULT false NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_entity_id`) REFERENCES `food_entities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_ingredients_meal_line_unique` ON `household_meal_ingredients` (`household_meal_id`,`line_index`);--> statement-breakpoint
CREATE INDEX `household_meal_ingredients_household_meal_id_idx` ON `household_meal_ingredients` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `household_meal_ingredients_food_entity_id_idx` ON `household_meal_ingredients` (`food_entity_id`);--> statement-breakpoint
CREATE TABLE `household_meal_instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`section_name` text,
	`text` text NOT NULL,
	`duration_minutes` integer,
	`confidence` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_instructions_meal_step_unique` ON `household_meal_instructions` (`household_meal_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `household_meal_instructions_household_meal_id_idx` ON `household_meal_instructions` (`household_meal_id`);--> statement-breakpoint
CREATE TABLE `household_meal_nutrition` (
	`household_meal_id` text PRIMARY KEY NOT NULL,
	`calories` real,
	`protein_grams` real,
	`carbs_grams` real,
	`fat_grams` real,
	`serving_size` text,
	`confidence` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `household_meals` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_recipe_id` text,
	`recipe_snapshot_json` text,
	`recipe_source_json` text,
	`recipe_metadata_json` text,
	`promoted_to_user_recipe_id` text,
	`include_in_grocery_list` integer DEFAULT false NOT NULL,
	`scheduled_for` text,
	`date` text,
	`slot` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`servings_planned` real DEFAULT 1 NOT NULL,
	`servings_cooked` real,
	`planned_cook_workos_user_id` text,
	`ingredient_purchase_state` text DEFAULT 'unknown' NOT NULL,
	`sort_order` integer,
	`last_considered_at` text,
	`replaced_by_household_meal_id` text,
	`replacement_kind` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`promoted_to_user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "household_meals_recipe_source_check" CHECK("household_meals"."user_recipe_id" IS NOT NULL OR "household_meals"."recipe_snapshot_json" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `household_meals_household_id_idx` ON `household_meals` (`household_id`);--> statement-breakpoint
CREATE INDEX `household_meals_user_recipe_id_idx` ON `household_meals` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `household_meals_status_idx` ON `household_meals` (`status`);--> statement-breakpoint
CREATE INDEX `household_meals_scheduled_for_idx` ON `household_meals` (`scheduled_for`);--> statement-breakpoint
CREATE INDEX `household_meals_date_idx` ON `household_meals` (`date`);--> statement-breakpoint
CREATE INDEX `household_meals_include_in_grocery_list_idx` ON `household_meals` (`include_in_grocery_list`);--> statement-breakpoint
CREATE TABLE `household_appliances` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`appliance` text NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `household_appliances_household_id_idx` ON `household_appliances` (`household_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `household_appliances_household_appliance_unique` ON `household_appliances` (`household_id`,`appliance`);--> statement-breakpoint
CREATE TABLE `household_profiles` (
	`household_id` text PRIMARY KEY NOT NULL,
	`default_servings` integer DEFAULT 1 NOT NULL,
	`default_calendar_duration_days` integer DEFAULT 7 NOT NULL,
	`default_calendar_anchor` text DEFAULT 'today' NOT NULL,
	`preferred_dinner_time` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_cooking_profiles` (
	`workos_user_id` text PRIMARY KEY NOT NULL,
	`cook_time_coefficient` real DEFAULT 1 NOT NULL,
	`preferred_dinner_time` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meal_check_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text,
	`user_recipe_id` text,
	`planned_cook_workos_user_id` text,
	`actual_cook_workos_user_id` text,
	`reported_by_workos_user_id` text NOT NULL,
	`actual_minutes` integer,
	`claimed_minutes` integer,
	`cook_time_ratio` real,
	`servings_cooked` real,
	`verdict` text,
	`reasons_json` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meal_check_ins_subject_check" CHECK("meal_check_ins"."household_meal_id" IS NOT NULL OR "meal_check_ins"."user_recipe_id" IS NOT NULL),
	CONSTRAINT "meal_check_ins_cook_time_check" CHECK("meal_check_ins"."actual_minutes" IS NULL OR "meal_check_ins"."actual_cook_workos_user_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `meal_check_ins_household_meal_id_idx` ON `meal_check_ins` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_user_recipe_id_idx` ON `meal_check_ins` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_reported_by_idx` ON `meal_check_ins` (`reported_by_workos_user_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_actual_cook_idx` ON `meal_check_ins` (`actual_cook_workos_user_id`);--> statement-breakpoint
CREATE TABLE `user_recipe_appliance_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_id` text NOT NULL,
	`appliance` text NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'instruction_heuristic' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_recipe_appliance_requirements_recipe_appliance_unique` ON `user_recipe_appliance_requirements` (`user_recipe_id`,`appliance`);--> statement-breakpoint
CREATE INDEX `user_recipe_appliance_requirements_user_recipe_id_idx` ON `user_recipe_appliance_requirements` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_appliance_requirements_appliance_idx` ON `user_recipe_appliance_requirements` (`appliance`);--> statement-breakpoint
CREATE TABLE `user_recipe_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_id` text NOT NULL,
	`line_index` integer NOT NULL,
	`original_text` text NOT NULL,
	`parsed_name` text,
	`food_entity_id` text,
	`quantity` real,
	`unit` text,
	`category` text,
	`optional` integer DEFAULT false NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_entity_id`) REFERENCES `food_entities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_recipe_ingredients_recipe_line_unique` ON `user_recipe_ingredients` (`user_recipe_id`,`line_index`);--> statement-breakpoint
CREATE INDEX `user_recipe_ingredients_user_recipe_id_idx` ON `user_recipe_ingredients` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_ingredients_food_entity_id_idx` ON `user_recipe_ingredients` (`food_entity_id`);--> statement-breakpoint
CREATE TABLE `user_recipe_instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`section_name` text,
	`text` text NOT NULL,
	`duration_minutes` integer,
	`confidence` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_recipe_instructions_recipe_step_unique` ON `user_recipe_instructions` (`user_recipe_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `user_recipe_instructions_user_recipe_id_idx` ON `user_recipe_instructions` (`user_recipe_id`);--> statement-breakpoint
CREATE TABLE `user_recipe_nutrition` (
	`user_recipe_id` text PRIMARY KEY NOT NULL,
	`calories` real,
	`protein_grams` real,
	`carbs_grams` real,
	`fat_grams` real,
	`serving_size` text,
	`confidence` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`saved_from_household_id` text,
	`schema_org_recipe_json` text NOT NULL,
	`raw_json_ld` text,
	`source_url` text,
	`source_site_name` text,
	`source_author_name` text,
	`source_publisher_name` text,
	`source_is_based_on_url` text,
	`source_imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`source_html_hash` text,
	`familiarity` text DEFAULT 'exploration' NOT NULL,
	`latest_verdict` text,
	`times_cooked` integer DEFAULT 0 NOT NULL,
	`last_cooked_at` text,
	`average_actual_minutes` real,
	`source_claimed_minutes` integer,
	`parse_confidence` real,
	`ingredient_confidence` real,
	`instruction_confidence` real,
	`nutrition_confidence` real,
	`time_realism_confidence` real,
	`user_notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_recipes_workos_user_id_idx` ON `user_recipes` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `user_recipes_saved_from_household_id_idx` ON `user_recipes` (`saved_from_household_id`);--> statement-breakpoint
CREATE INDEX `user_recipes_familiarity_idx` ON `user_recipes` (`familiarity`);