CREATE TABLE `food_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`food_id` text NOT NULL,
	`alias` text NOT NULL,
	`locale` text NOT NULL,
	`source_domain` text,
	`default_for_locale` integer DEFAULT false NOT NULL,
	`default_measure_unit_id` text,
	`default_measure_base_unit_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_measure_unit_id`,`default_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_aliases_domain_not_default_check" CHECK("food_aliases"."source_domain" IS NULL OR "food_aliases"."default_for_locale" = 0),
	CONSTRAINT "food_aliases_default_measure_pair_check" CHECK(("food_aliases"."default_measure_unit_id" IS NULL AND "food_aliases"."default_measure_base_unit_id" IS NULL) OR ("food_aliases"."default_measure_unit_id" IS NOT NULL AND "food_aliases"."default_measure_base_unit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_aliases_default_per_food_locale` ON `food_aliases` (`food_id`,`locale`) WHERE "food_aliases"."default_for_locale" = 1 AND "food_aliases"."source_domain" IS NULL;--> statement-breakpoint
CREATE INDEX `food_aliases_food_id_idx` ON `food_aliases` (`food_id`);--> statement-breakpoint
CREATE INDEX `food_aliases_locale_alias_idx` ON `food_aliases` (`locale`,`alias`);--> statement-breakpoint
CREATE INDEX `food_aliases_import_lookup_idx` ON `food_aliases` (`source_domain`,`locale`,`alias`);--> statement-breakpoint
CREATE TABLE `food_household_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`food_id` text NOT NULL,
	`alias` text NOT NULL,
	`locale` text NOT NULL,
	`source_domain` text,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`default_measure_unit_id` text,
	`default_measure_base_unit_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_measure_unit_id`,`default_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_household_aliases_default_measure_pair_check" CHECK(("food_household_aliases"."default_measure_unit_id" IS NULL AND "food_household_aliases"."default_measure_base_unit_id" IS NULL) OR ("food_household_aliases"."default_measure_unit_id" IS NOT NULL AND "food_household_aliases"."default_measure_base_unit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `food_household_aliases_household_idx` ON `food_household_aliases` (`household_id`);--> statement-breakpoint
CREATE INDEX `food_household_aliases_food_id_idx` ON `food_household_aliases` (`food_id`);--> statement-breakpoint
CREATE INDEX `food_household_aliases_lookup_idx` ON `food_household_aliases` (`household_id`,`locale`,`alias`);--> statement-breakpoint
CREATE INDEX `food_household_aliases_adoption_idx` ON `food_household_aliases` (`adoption_status`);--> statement-breakpoint
CREATE TABLE `food_household_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`canonical_label` text NOT NULL,
	`default_measure_unit_id` text,
	`default_measure_base_unit_id` text,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_measure_unit_id`,`default_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_household_entries_default_measure_pair_check" CHECK(("food_household_entries"."default_measure_unit_id" IS NULL AND "food_household_entries"."default_measure_base_unit_id" IS NULL) OR ("food_household_entries"."default_measure_unit_id" IS NOT NULL AND "food_household_entries"."default_measure_base_unit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_household_entries_label_unique` ON `food_household_entries` (`household_id`,`canonical_label`);--> statement-breakpoint
CREATE INDEX `food_household_entries_household_idx` ON `food_household_entries` (`household_id`);--> statement-breakpoint
CREATE INDEX `food_household_entries_adoption_idx` ON `food_household_entries` (`adoption_status`);--> statement-breakpoint
CREATE TABLE `food_user_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`food_id` text NOT NULL,
	`alias` text NOT NULL,
	`locale` text NOT NULL,
	`source_domain` text,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`default_measure_unit_id` text,
	`default_measure_base_unit_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_measure_unit_id`,`default_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_user_aliases_default_measure_pair_check" CHECK(("food_user_aliases"."default_measure_unit_id" IS NULL AND "food_user_aliases"."default_measure_base_unit_id" IS NULL) OR ("food_user_aliases"."default_measure_unit_id" IS NOT NULL AND "food_user_aliases"."default_measure_base_unit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `food_user_aliases_user_idx` ON `food_user_aliases` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `food_user_aliases_food_id_idx` ON `food_user_aliases` (`food_id`);--> statement-breakpoint
CREATE INDEX `food_user_aliases_lookup_idx` ON `food_user_aliases` (`workos_user_id`,`locale`,`alias`);--> statement-breakpoint
CREATE INDEX `food_user_aliases_adoption_idx` ON `food_user_aliases` (`adoption_status`);--> statement-breakpoint
CREATE TABLE `food_user_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`canonical_label` text NOT NULL,
	`default_measure_unit_id` text,
	`default_measure_base_unit_id` text,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_measure_unit_id`,`default_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_user_entries_default_measure_pair_check" CHECK(("food_user_entries"."default_measure_unit_id" IS NULL AND "food_user_entries"."default_measure_base_unit_id" IS NULL) OR ("food_user_entries"."default_measure_unit_id" IS NOT NULL AND "food_user_entries"."default_measure_base_unit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_user_entries_label_unique` ON `food_user_entries` (`workos_user_id`,`canonical_label`);--> statement-breakpoint
CREATE INDEX `food_user_entries_user_idx` ON `food_user_entries` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `food_user_entries_adoption_idx` ON `food_user_entries` (`adoption_status`);--> statement-breakpoint
CREATE TABLE `foods` (
	`id` text PRIMARY KEY NOT NULL,
	`default_measure_unit_id` text NOT NULL,
	`default_measure_base_unit_id` text NOT NULL,
	FOREIGN KEY (`default_measure_unit_id`,`default_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_food_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`food_id` text NOT NULL,
	`preference` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_food_preferences_user_food_unique` ON `user_food_preferences` (`workos_user_id`,`food_id`);--> statement-breakpoint
CREATE INDEX `user_food_preferences_user_idx` ON `user_food_preferences` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `user_food_preferences_food_idx` ON `user_food_preferences` (`food_id`);--> statement-breakpoint
CREATE INDEX `user_food_preferences_preference_idx` ON `user_food_preferences` (`preference`);--> statement-breakpoint
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
CREATE TABLE `household_meal_classifications` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`schema_org_value` text,
	`locale` text,
	`confidence` real DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_classifications_unique` ON `household_meal_classifications` (`household_meal_id`,`kind`,`normalized_value`,`locale`);--> statement-breakpoint
CREATE INDEX `household_meal_classifications_meal_id_idx` ON `household_meal_classifications` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `household_meal_classifications_kind_value_idx` ON `household_meal_classifications` (`kind`,`normalized_value`);--> statement-breakpoint
CREATE TABLE `household_meal_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`line_index` integer NOT NULL,
	`original_text` text NOT NULL,
	`source_amount_text` text,
	`source_quantity` real,
	`source_unit_label` text,
	`source_food_label` text NOT NULL,
	`base_food_id` text,
	`base_quantity` real,
	`base_unit_id` text,
	`base_unit_family_id` text,
	`optional` integer DEFAULT false NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`base_unit_id`,`base_unit_family_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "household_meal_ingredients_base_unit_pair_check" CHECK(("household_meal_ingredients"."base_unit_id" IS NULL AND "household_meal_ingredients"."base_unit_family_id" IS NULL) OR ("household_meal_ingredients"."base_unit_id" IS NOT NULL AND "household_meal_ingredients"."base_unit_family_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_ingredients_meal_line_unique` ON `household_meal_ingredients` (`household_meal_id`,`line_index`);--> statement-breakpoint
CREATE INDEX `household_meal_ingredients_household_meal_id_idx` ON `household_meal_ingredients` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `household_meal_ingredients_meal_food_idx` ON `household_meal_ingredients` (`household_meal_id`,`base_food_id`);--> statement-breakpoint
CREATE INDEX `household_meal_ingredients_base_food_id_idx` ON `household_meal_ingredients` (`base_food_id`);--> statement-breakpoint
CREATE INDEX `household_meal_ingredients_base_unit_id_idx` ON `household_meal_ingredients` (`base_unit_id`);--> statement-breakpoint
CREATE TABLE `household_meal_instruction_events` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_instruction_id` text NOT NULL,
	`kind` text NOT NULL,
	`appliance` text,
	`source_text` text NOT NULL,
	`value` real,
	`unit_id` text,
	`base_value` real,
	`base_unit_id` text,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_instruction_id`) REFERENCES `household_meal_instructions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "household_meal_instruction_events_unit_pair_check" CHECK(("household_meal_instruction_events"."unit_id" IS NULL AND "household_meal_instruction_events"."base_unit_id" IS NULL) OR ("household_meal_instruction_events"."unit_id" IS NOT NULL AND "household_meal_instruction_events"."base_unit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `household_meal_instruction_events_instruction_idx` ON `household_meal_instruction_events` (`household_meal_instruction_id`);--> statement-breakpoint
CREATE INDEX `household_meal_instruction_events_kind_idx` ON `household_meal_instruction_events` (`kind`);--> statement-breakpoint
CREATE TABLE `household_meal_instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`section_name` text,
	`text` text NOT NULL,
	`duration_minutes` integer,
	`confidence` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_instructions_meal_step_unique` ON `household_meal_instructions` (`household_meal_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `household_meal_instructions_household_meal_id_idx` ON `household_meal_instructions` (`household_meal_id`);--> statement-breakpoint
CREATE TABLE `household_meal_media` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`url` text,
	`content_url` text,
	`embed_url` text,
	`thumbnail_url` text,
	`name` text,
	`caption` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `household_meal_media_meal_id_idx` ON `household_meal_media` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `household_meal_media_kind_idx` ON `household_meal_media` (`kind`);--> statement-breakpoint
CREATE TABLE `household_meal_nutrition_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`nutrient` text NOT NULL,
	`schema_org_property` text NOT NULL,
	`original_text` text NOT NULL,
	`amount` real,
	`unit_id` text,
	`base_amount` real,
	`base_unit_id` text,
	`locale` text,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "household_meal_nutrition_facts_unit_pair_check" CHECK(("household_meal_nutrition_facts"."unit_id" IS NULL AND "household_meal_nutrition_facts"."base_unit_id" IS NULL) OR ("household_meal_nutrition_facts"."unit_id" IS NOT NULL AND "household_meal_nutrition_facts"."base_unit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_nutrition_facts_unique` ON `household_meal_nutrition_facts` (`household_meal_id`,`schema_org_property`);--> statement-breakpoint
CREATE INDEX `household_meal_nutrition_facts_meal_id_idx` ON `household_meal_nutrition_facts` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `household_meal_nutrition_facts_nutrient_idx` ON `household_meal_nutrition_facts` (`nutrient`);--> statement-breakpoint
CREATE TABLE `household_meal_user_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`user_recipe_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_user_recipes_unique` ON `household_meal_user_recipes` (`household_meal_id`,`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `household_meal_user_recipes_meal_idx` ON `household_meal_user_recipes` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `household_meal_user_recipes_recipe_idx` ON `household_meal_user_recipes` (`user_recipe_id`);--> statement-breakpoint
CREATE TABLE `household_meals` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`image_url` text,
	`date` text,
	`time` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`prep_time_minutes` integer,
	`cook_time_minutes` integer,
	`total_time_minutes` integer,
	`yield` real,
	`planned_yield` integer,
	`planned_cook_workos_user_id` text,
	`sort_order` integer,
	`source_yield_text` text,
	`source_date_published` text,
	`source_date_modified` text,
	`source_language` text,
	`source_url` text,
	`source_site_name` text,
	`source_author_name` text,
	`source_publisher_name` text,
	`source_is_based_on_url` text,
	`source_imported_at` text,
	`source_html_hash` text,
	`source_rating_value` real,
	`source_rating_count` integer,
	`source_review_count` integer,
	`source_claimed_minutes` integer,
	`parse_confidence` real,
	`ingredient_confidence` real,
	`instruction_confidence` real,
	`nutrition_confidence` real,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`planned_cook_workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `household_meals_household_id_idx` ON `household_meals` (`household_id`);--> statement-breakpoint
CREATE INDEX `household_meals_household_status_idx` ON `household_meals` (`household_id`,`status`);--> statement-breakpoint
CREATE INDEX `household_meals_household_date_time_idx` ON `household_meals` (`household_id`,`date`,`time`);--> statement-breakpoint
CREATE INDEX `household_meals_household_floating_sort_idx` ON `household_meals` (`household_id`,`date`,`sort_order`);--> statement-breakpoint
CREATE INDEX `household_meals_planned_cook_idx` ON `household_meals` (`planned_cook_workos_user_id`);--> statement-breakpoint
CREATE INDEX `household_meals_sort_order_idx` ON `household_meals` (`sort_order`);--> statement-breakpoint
CREATE TABLE `household_appliances` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`appliance` text NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `household_appliances_household_id_idx` ON `household_appliances` (`household_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `household_appliances_household_appliance_unique` ON `household_appliances` (`household_id`,`appliance`);--> statement-breakpoint
CREATE TABLE `households` (
	`household_id` text PRIMARY KEY NOT NULL,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`timezone` text,
	`week_starts_on` integer DEFAULT 1 NOT NULL,
	`default_planned_yield` integer DEFAULT 1 NOT NULL,
	`preferred_dinner_time` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meal_check_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`household_meal_id` text NOT NULL,
	`cook_time` integer,
	`verdict` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meal_check_ins_cook_time_positive_check" CHECK("meal_check_ins"."cook_time" IS NULL OR "meal_check_ins"."cook_time" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_check_ins_meal_user_unique` ON `meal_check_ins` (`household_meal_id`,`workos_user_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_household_meal_id_idx` ON `meal_check_ins` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_workos_user_id_idx` ON `meal_check_ins` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_user_verdict_idx` ON `meal_check_ins` (`workos_user_id`,`verdict`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_verdict_idx` ON `meal_check_ins` (`verdict`);--> statement-breakpoint
CREATE TABLE `household_food_display_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`food_id` text NOT NULL,
	`locale` text NOT NULL,
	`preferred_food_alias_scope` text,
	`preferred_food_alias_id` text,
	`preferred_measure_unit_id` text,
	`preferred_measure_base_unit_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`preferred_measure_unit_id`,`preferred_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "household_food_display_overrides_alias_pair_check" CHECK(("household_food_display_overrides"."preferred_food_alias_scope" IS NULL AND "household_food_display_overrides"."preferred_food_alias_id" IS NULL) OR ("household_food_display_overrides"."preferred_food_alias_scope" IS NOT NULL AND "household_food_display_overrides"."preferred_food_alias_id" IS NOT NULL)),
	CONSTRAINT "household_food_display_overrides_measure_pair_check" CHECK(("household_food_display_overrides"."preferred_measure_unit_id" IS NULL AND "household_food_display_overrides"."preferred_measure_base_unit_id" IS NULL) OR ("household_food_display_overrides"."preferred_measure_unit_id" IS NOT NULL AND "household_food_display_overrides"."preferred_measure_base_unit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_food_display_overrides_unique` ON `household_food_display_overrides` (`household_id`,`food_id`,`locale`);--> statement-breakpoint
CREATE INDEX `household_food_display_overrides_household_idx` ON `household_food_display_overrides` (`household_id`);--> statement-breakpoint
CREATE INDEX `household_food_display_overrides_food_locale_idx` ON `household_food_display_overrides` (`food_id`,`locale`);--> statement-breakpoint
CREATE TABLE `household_unit_display_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`base_unit_id` text NOT NULL,
	`locale` text NOT NULL,
	`preferred_unit_id` text NOT NULL,
	`preferred_unit_alias_scope` text,
	`preferred_unit_alias_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preferred_unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "household_unit_display_overrides_alias_pair_check" CHECK(("household_unit_display_overrides"."preferred_unit_alias_scope" IS NULL AND "household_unit_display_overrides"."preferred_unit_alias_id" IS NULL) OR ("household_unit_display_overrides"."preferred_unit_alias_scope" IS NOT NULL AND "household_unit_display_overrides"."preferred_unit_alias_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_unit_display_overrides_unique` ON `household_unit_display_overrides` (`household_id`,`base_unit_id`,`locale`);--> statement-breakpoint
CREATE INDEX `household_unit_display_overrides_household_idx` ON `household_unit_display_overrides` (`household_id`);--> statement-breakpoint
CREATE INDEX `household_unit_display_overrides_base_locale_idx` ON `household_unit_display_overrides` (`base_unit_id`,`locale`);--> statement-breakpoint
CREATE TABLE `user_food_display_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`food_id` text NOT NULL,
	`locale` text NOT NULL,
	`preferred_food_alias_scope` text,
	`preferred_food_alias_id` text,
	`preferred_measure_unit_id` text,
	`preferred_measure_base_unit_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`preferred_measure_unit_id`,`preferred_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_food_display_overrides_alias_pair_check" CHECK(("user_food_display_overrides"."preferred_food_alias_scope" IS NULL AND "user_food_display_overrides"."preferred_food_alias_id" IS NULL) OR ("user_food_display_overrides"."preferred_food_alias_scope" IS NOT NULL AND "user_food_display_overrides"."preferred_food_alias_id" IS NOT NULL)),
	CONSTRAINT "user_food_display_overrides_measure_pair_check" CHECK(("user_food_display_overrides"."preferred_measure_unit_id" IS NULL AND "user_food_display_overrides"."preferred_measure_base_unit_id" IS NULL) OR ("user_food_display_overrides"."preferred_measure_unit_id" IS NOT NULL AND "user_food_display_overrides"."preferred_measure_base_unit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_food_display_overrides_unique` ON `user_food_display_overrides` (`workos_user_id`,`food_id`,`locale`);--> statement-breakpoint
CREATE INDEX `user_food_display_overrides_user_idx` ON `user_food_display_overrides` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `user_food_display_overrides_food_locale_idx` ON `user_food_display_overrides` (`food_id`,`locale`);--> statement-breakpoint
CREATE TABLE `user_unit_display_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`base_unit_id` text NOT NULL,
	`locale` text NOT NULL,
	`preferred_unit_id` text NOT NULL,
	`preferred_unit_alias_scope` text,
	`preferred_unit_alias_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preferred_unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_unit_display_overrides_alias_pair_check" CHECK(("user_unit_display_overrides"."preferred_unit_alias_scope" IS NULL AND "user_unit_display_overrides"."preferred_unit_alias_id" IS NULL) OR ("user_unit_display_overrides"."preferred_unit_alias_scope" IS NOT NULL AND "user_unit_display_overrides"."preferred_unit_alias_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_unit_display_overrides_unique` ON `user_unit_display_overrides` (`workos_user_id`,`base_unit_id`,`locale`);--> statement-breakpoint
CREATE INDEX `user_unit_display_overrides_user_idx` ON `user_unit_display_overrides` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `user_unit_display_overrides_base_locale_idx` ON `user_unit_display_overrides` (`base_unit_id`,`locale`);--> statement-breakpoint
CREATE TABLE `unit_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`base_unit_id` text NOT NULL,
	`alias` text NOT NULL,
	`locale` text NOT NULL,
	`source_domain` text,
	`default_for_locale` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "unit_aliases_domain_not_default_check" CHECK("unit_aliases"."source_domain" IS NULL OR "unit_aliases"."default_for_locale" = 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_aliases_default_per_base_locale` ON `unit_aliases` (`base_unit_id`,`locale`) WHERE "unit_aliases"."default_for_locale" = 1 AND "unit_aliases"."source_domain" IS NULL;--> statement-breakpoint
CREATE INDEX `unit_aliases_unit_id_idx` ON `unit_aliases` (`unit_id`);--> statement-breakpoint
CREATE INDEX `unit_aliases_base_unit_locale_idx` ON `unit_aliases` (`base_unit_id`,`locale`);--> statement-breakpoint
CREATE INDEX `unit_aliases_locale_alias_idx` ON `unit_aliases` (`locale`,`alias`);--> statement-breakpoint
CREATE INDEX `unit_aliases_import_lookup_idx` ON `unit_aliases` (`source_domain`,`locale`,`alias`);--> statement-breakpoint
CREATE TABLE `unit_household_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`base_unit_id` text NOT NULL,
	`alias` text NOT NULL,
	`locale` text NOT NULL,
	`source_domain` text,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `unit_household_aliases_household_idx` ON `unit_household_aliases` (`household_id`);--> statement-breakpoint
CREATE INDEX `unit_household_aliases_unit_idx` ON `unit_household_aliases` (`unit_id`);--> statement-breakpoint
CREATE INDEX `unit_household_aliases_lookup_idx` ON `unit_household_aliases` (`household_id`,`locale`,`alias`);--> statement-breakpoint
CREATE INDEX `unit_household_aliases_adoption_idx` ON `unit_household_aliases` (`adoption_status`);--> statement-breakpoint
CREATE TABLE `unit_household_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`canonical_label` text NOT NULL,
	`base_unit_id` text NOT NULL,
	`to_base_factor` real DEFAULT 1 NOT NULL,
	`to_base_offset` real DEFAULT 0 NOT NULL,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_household_entries_label_unique` ON `unit_household_entries` (`household_id`,`canonical_label`);--> statement-breakpoint
CREATE INDEX `unit_household_entries_household_idx` ON `unit_household_entries` (`household_id`);--> statement-breakpoint
CREATE INDEX `unit_household_entries_base_unit_idx` ON `unit_household_entries` (`base_unit_id`);--> statement-breakpoint
CREATE INDEX `unit_household_entries_adoption_idx` ON `unit_household_entries` (`adoption_status`);--> statement-breakpoint
CREATE TABLE `unit_user_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`base_unit_id` text NOT NULL,
	`alias` text NOT NULL,
	`locale` text NOT NULL,
	`source_domain` text,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `unit_user_aliases_user_idx` ON `unit_user_aliases` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `unit_user_aliases_unit_idx` ON `unit_user_aliases` (`unit_id`);--> statement-breakpoint
CREATE INDEX `unit_user_aliases_lookup_idx` ON `unit_user_aliases` (`workos_user_id`,`locale`,`alias`);--> statement-breakpoint
CREATE INDEX `unit_user_aliases_adoption_idx` ON `unit_user_aliases` (`adoption_status`);--> statement-breakpoint
CREATE TABLE `unit_user_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`canonical_label` text NOT NULL,
	`base_unit_id` text NOT NULL,
	`to_base_factor` real DEFAULT 1 NOT NULL,
	`to_base_offset` real DEFAULT 0 NOT NULL,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_user_entries_label_unique` ON `unit_user_entries` (`workos_user_id`,`canonical_label`);--> statement-breakpoint
CREATE INDEX `unit_user_entries_user_idx` ON `unit_user_entries` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `unit_user_entries_base_unit_idx` ON `unit_user_entries` (`base_unit_id`);--> statement-breakpoint
CREATE INDEX `unit_user_entries_adoption_idx` ON `unit_user_entries` (`adoption_status`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`base_unit_id` text NOT NULL,
	`to_base_factor` real DEFAULT 1 NOT NULL,
	`to_base_offset` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_id_base_unit_unique` ON `units` (`id`,`base_unit_id`);--> statement-breakpoint
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
CREATE TABLE `user_recipe_classifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`schema_org_value` text,
	`locale` text,
	`confidence` real DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_recipe_classifications_unique` ON `user_recipe_classifications` (`user_recipe_id`,`kind`,`normalized_value`,`locale`);--> statement-breakpoint
CREATE INDEX `user_recipe_classifications_recipe_id_idx` ON `user_recipe_classifications` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_classifications_kind_value_idx` ON `user_recipe_classifications` (`kind`,`normalized_value`);--> statement-breakpoint
CREATE TABLE `user_recipe_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_id` text NOT NULL,
	`line_index` integer NOT NULL,
	`original_text` text NOT NULL,
	`source_amount_text` text,
	`source_quantity` real,
	`source_unit_label` text,
	`source_food_label` text NOT NULL,
	`base_food_id` text,
	`base_quantity` real,
	`base_unit_id` text,
	`base_unit_family_id` text,
	`optional` integer DEFAULT false NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`base_unit_id`,`base_unit_family_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_recipe_ingredients_base_unit_pair_check" CHECK(("user_recipe_ingredients"."base_unit_id" IS NULL AND "user_recipe_ingredients"."base_unit_family_id" IS NULL) OR ("user_recipe_ingredients"."base_unit_id" IS NOT NULL AND "user_recipe_ingredients"."base_unit_family_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_recipe_ingredients_recipe_line_unique` ON `user_recipe_ingredients` (`user_recipe_id`,`line_index`);--> statement-breakpoint
CREATE INDEX `user_recipe_ingredients_user_recipe_id_idx` ON `user_recipe_ingredients` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_ingredients_recipe_food_idx` ON `user_recipe_ingredients` (`user_recipe_id`,`base_food_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_ingredients_base_food_id_idx` ON `user_recipe_ingredients` (`base_food_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_ingredients_base_unit_id_idx` ON `user_recipe_ingredients` (`base_unit_id`);--> statement-breakpoint
CREATE TABLE `user_recipe_instruction_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_instruction_id` text NOT NULL,
	`kind` text NOT NULL,
	`appliance` text,
	`source_text` text NOT NULL,
	`value` real,
	`unit_id` text,
	`base_value` real,
	`base_unit_id` text,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_instruction_id`) REFERENCES `user_recipe_instructions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_recipe_instruction_events_unit_pair_check" CHECK(("user_recipe_instruction_events"."unit_id" IS NULL AND "user_recipe_instruction_events"."base_unit_id" IS NULL) OR ("user_recipe_instruction_events"."unit_id" IS NOT NULL AND "user_recipe_instruction_events"."base_unit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `user_recipe_instruction_events_instruction_idx` ON `user_recipe_instruction_events` (`user_recipe_instruction_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_instruction_events_kind_idx` ON `user_recipe_instruction_events` (`kind`);--> statement-breakpoint
CREATE TABLE `user_recipe_instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`section_name` text,
	`text` text NOT NULL,
	`duration_minutes` integer,
	`confidence` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_recipe_instructions_recipe_step_unique` ON `user_recipe_instructions` (`user_recipe_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `user_recipe_instructions_user_recipe_id_idx` ON `user_recipe_instructions` (`user_recipe_id`);--> statement-breakpoint
CREATE TABLE `user_recipe_media` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_id` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`url` text,
	`content_url` text,
	`embed_url` text,
	`thumbnail_url` text,
	`name` text,
	`caption` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_recipe_media_recipe_id_idx` ON `user_recipe_media` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_media_kind_idx` ON `user_recipe_media` (`kind`);--> statement-breakpoint
CREATE TABLE `user_recipe_nutrition_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_id` text NOT NULL,
	`nutrient` text NOT NULL,
	`schema_org_property` text NOT NULL,
	`original_text` text NOT NULL,
	`amount` real,
	`unit_id` text,
	`base_amount` real,
	`base_unit_id` text,
	`locale` text,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_recipe_nutrition_facts_unit_pair_check" CHECK(("user_recipe_nutrition_facts"."unit_id" IS NULL AND "user_recipe_nutrition_facts"."base_unit_id" IS NULL) OR ("user_recipe_nutrition_facts"."unit_id" IS NOT NULL AND "user_recipe_nutrition_facts"."base_unit_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_recipe_nutrition_facts_unique` ON `user_recipe_nutrition_facts` (`user_recipe_id`,`schema_org_property`);--> statement-breakpoint
CREATE INDEX `user_recipe_nutrition_facts_recipe_id_idx` ON `user_recipe_nutrition_facts` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_nutrition_facts_nutrient_idx` ON `user_recipe_nutrition_facts` (`nutrient`);--> statement-breakpoint
CREATE TABLE `user_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`saved_from_household_id` text,
	`title` text NOT NULL,
	`description` text,
	`image_url` text,
	`prep_time_minutes` integer,
	`cook_time_minutes` integer,
	`total_time_minutes` integer,
	`yield` real,
	`source_yield_text` text,
	`source_date_published` text,
	`source_date_modified` text,
	`source_language` text,
	`source_url` text,
	`source_site_name` text,
	`source_author_name` text,
	`source_publisher_name` text,
	`source_is_based_on_url` text,
	`source_imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`source_html_hash` text,
	`source_rating_value` real,
	`source_rating_count` integer,
	`source_review_count` integer,
	`source_claimed_minutes` integer,
	`parse_confidence` real,
	`ingredient_confidence` real,
	`instruction_confidence` real,
	`nutrition_confidence` real,
	`user_notes` text,
	`deleted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`saved_from_household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `user_recipes_workos_user_id_idx` ON `user_recipes` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `user_recipes_user_visible_idx` ON `user_recipes` (`workos_user_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `user_recipes_saved_from_household_id_idx` ON `user_recipes` (`saved_from_household_id`);--> statement-breakpoint
CREATE INDEX `user_recipes_source_url_idx` ON `user_recipes` (`source_url`);--> statement-breakpoint
CREATE INDEX `user_recipes_source_html_hash_idx` ON `user_recipes` (`source_html_hash`);--> statement-breakpoint
CREATE INDEX `user_recipes_deleted_at_idx` ON `user_recipes` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`workos_user_id` text PRIMARY KEY NOT NULL,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`timezone` text,
	`cached_cook_time_coefficient` real DEFAULT 1 NOT NULL,
	`cook_time_coefficient_updated_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
