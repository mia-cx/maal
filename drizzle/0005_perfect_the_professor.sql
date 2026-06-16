PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_household_meal_classifications` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`schema_org_value` text,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "household_meal_classifications_confidence_range" CHECK("__new_household_meal_classifications"."confidence" IS NULL OR ("__new_household_meal_classifications"."confidence" >= 0 AND "__new_household_meal_classifications"."confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_household_meal_classifications`("id", "household_meal_id", "kind", "value", "normalized_value", "schema_org_value", "locale", "confidence", "created_at") SELECT "id", "household_meal_id", "kind", "value", "normalized_value", "schema_org_value", COALESCE("locale", 'en-US'), "confidence", "created_at" FROM `household_meal_classifications` AS source WHERE NOT EXISTS (SELECT 1 FROM `household_meal_classifications` AS duplicate WHERE duplicate."household_meal_id" = source."household_meal_id" AND duplicate."kind" = source."kind" AND duplicate."normalized_value" = source."normalized_value" AND COALESCE(duplicate."locale", 'en-US') = COALESCE(source."locale", 'en-US') AND duplicate.rowid < source.rowid);--> statement-breakpoint
DROP TABLE `household_meal_classifications`;--> statement-breakpoint
ALTER TABLE `__new_household_meal_classifications` RENAME TO `household_meal_classifications`;--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_classifications_unique` ON `household_meal_classifications` (`household_meal_id`,`kind`,`normalized_value`,`locale`);--> statement-breakpoint
CREATE INDEX `household_meal_classifications_meal_id_idx` ON `household_meal_classifications` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `household_meal_classifications_kind_value_idx` ON `household_meal_classifications` (`kind`,`normalized_value`);--> statement-breakpoint
CREATE TABLE `__new_household_meal_nutrition_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`nutrient` text NOT NULL,
	`schema_org_property` text NOT NULL,
	`original_text` text NOT NULL,
	`amount` real,
	`unit_id` text,
	`base_amount` real,
	`base_unit_id` text,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "household_meal_nutrition_facts_unit_pair_check" CHECK(("__new_household_meal_nutrition_facts"."unit_id" IS NULL AND "__new_household_meal_nutrition_facts"."base_unit_id" IS NULL) OR ("__new_household_meal_nutrition_facts"."unit_id" IS NOT NULL AND "__new_household_meal_nutrition_facts"."base_unit_id" IS NOT NULL)),
	CONSTRAINT "household_meal_nutrition_facts_confidence_range" CHECK("__new_household_meal_nutrition_facts"."confidence" IS NULL OR ("__new_household_meal_nutrition_facts"."confidence" >= 0 AND "__new_household_meal_nutrition_facts"."confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_household_meal_nutrition_facts`("id", "household_meal_id", "nutrient", "schema_org_property", "original_text", "amount", "unit_id", "base_amount", "base_unit_id", "locale", "confidence", "created_at", "updated_at") SELECT "id", "household_meal_id", "nutrient", "schema_org_property", "original_text", "amount", "unit_id", "base_amount", "base_unit_id", COALESCE("locale", 'en-US'), "confidence", "created_at", "updated_at" FROM `household_meal_nutrition_facts`;--> statement-breakpoint
DROP TABLE `household_meal_nutrition_facts`;--> statement-breakpoint
ALTER TABLE `__new_household_meal_nutrition_facts` RENAME TO `household_meal_nutrition_facts`;--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_nutrition_facts_unique` ON `household_meal_nutrition_facts` (`household_meal_id`,`schema_org_property`);--> statement-breakpoint
CREATE INDEX `household_meal_nutrition_facts_meal_id_idx` ON `household_meal_nutrition_facts` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `household_meal_nutrition_facts_nutrient_idx` ON `household_meal_nutrition_facts` (`nutrient`);--> statement-breakpoint
CREATE TABLE `__new_user_recipe_classifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`schema_org_value` text,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_recipe_classifications_confidence_range" CHECK("__new_user_recipe_classifications"."confidence" IS NULL OR ("__new_user_recipe_classifications"."confidence" >= 0 AND "__new_user_recipe_classifications"."confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_user_recipe_classifications`("id", "user_recipe_id", "kind", "value", "normalized_value", "schema_org_value", "locale", "confidence", "created_at") SELECT "id", "user_recipe_id", "kind", "value", "normalized_value", "schema_org_value", COALESCE("locale", 'en-US'), "confidence", "created_at" FROM `user_recipe_classifications` AS source WHERE NOT EXISTS (SELECT 1 FROM `user_recipe_classifications` AS duplicate WHERE duplicate."user_recipe_id" = source."user_recipe_id" AND duplicate."kind" = source."kind" AND duplicate."normalized_value" = source."normalized_value" AND COALESCE(duplicate."locale", 'en-US') = COALESCE(source."locale", 'en-US') AND duplicate.rowid < source.rowid);--> statement-breakpoint
DROP TABLE `user_recipe_classifications`;--> statement-breakpoint
ALTER TABLE `__new_user_recipe_classifications` RENAME TO `user_recipe_classifications`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_recipe_classifications_unique` ON `user_recipe_classifications` (`user_recipe_id`,`kind`,`normalized_value`,`locale`);--> statement-breakpoint
CREATE INDEX `user_recipe_classifications_recipe_id_idx` ON `user_recipe_classifications` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_classifications_kind_value_idx` ON `user_recipe_classifications` (`kind`,`normalized_value`);--> statement-breakpoint
CREATE TABLE `__new_user_recipe_nutrition_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_id` text NOT NULL,
	`nutrient` text NOT NULL,
	`schema_org_property` text NOT NULL,
	`original_text` text NOT NULL,
	`amount` real,
	`unit_id` text,
	`base_amount` real,
	`base_unit_id` text,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_recipe_nutrition_facts_unit_pair_check" CHECK(("__new_user_recipe_nutrition_facts"."unit_id" IS NULL AND "__new_user_recipe_nutrition_facts"."base_unit_id" IS NULL) OR ("__new_user_recipe_nutrition_facts"."unit_id" IS NOT NULL AND "__new_user_recipe_nutrition_facts"."base_unit_id" IS NOT NULL)),
	CONSTRAINT "user_recipe_nutrition_facts_confidence_range" CHECK("__new_user_recipe_nutrition_facts"."confidence" IS NULL OR ("__new_user_recipe_nutrition_facts"."confidence" >= 0 AND "__new_user_recipe_nutrition_facts"."confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_user_recipe_nutrition_facts`("id", "user_recipe_id", "nutrient", "schema_org_property", "original_text", "amount", "unit_id", "base_amount", "base_unit_id", "locale", "confidence", "created_at", "updated_at") SELECT "id", "user_recipe_id", "nutrient", "schema_org_property", "original_text", "amount", "unit_id", "base_amount", "base_unit_id", COALESCE("locale", 'en-US'), "confidence", "created_at", "updated_at" FROM `user_recipe_nutrition_facts`;--> statement-breakpoint
DROP TABLE `user_recipe_nutrition_facts`;--> statement-breakpoint
ALTER TABLE `__new_user_recipe_nutrition_facts` RENAME TO `user_recipe_nutrition_facts`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_recipe_nutrition_facts_unique` ON `user_recipe_nutrition_facts` (`user_recipe_id`,`schema_org_property`);--> statement-breakpoint
CREATE INDEX `user_recipe_nutrition_facts_recipe_id_idx` ON `user_recipe_nutrition_facts` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_nutrition_facts_nutrient_idx` ON `user_recipe_nutrition_facts` (`nutrient`);--> statement-breakpoint
CREATE TABLE `__new_household_meal_appliance_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`appliance` text NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'instruction_heuristic' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "household_meal_appliance_requirements_confidence_range" CHECK("__new_household_meal_appliance_requirements"."confidence" IS NULL OR ("__new_household_meal_appliance_requirements"."confidence" >= 0 AND "__new_household_meal_appliance_requirements"."confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_household_meal_appliance_requirements`("id", "household_meal_id", "appliance", "required", "source", "confidence", "notes", "created_at", "updated_at") SELECT "id", "household_meal_id", "appliance", "required", "source", "confidence", "notes", "created_at", "updated_at" FROM `household_meal_appliance_requirements`;--> statement-breakpoint
DROP TABLE `household_meal_appliance_requirements`;--> statement-breakpoint
ALTER TABLE `__new_household_meal_appliance_requirements` RENAME TO `household_meal_appliance_requirements`;--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_appliance_requirements_meal_appliance_unique` ON `household_meal_appliance_requirements` (`household_meal_id`,`appliance`);--> statement-breakpoint
CREATE INDEX `household_meal_appliance_requirements_household_meal_id_idx` ON `household_meal_appliance_requirements` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `household_meal_appliance_requirements_appliance_idx` ON `household_meal_appliance_requirements` (`appliance`);--> statement-breakpoint
CREATE TABLE `__new_household_meal_ingredients` (
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
	CONSTRAINT "household_meal_ingredients_base_unit_pair_check" CHECK(("__new_household_meal_ingredients"."base_unit_id" IS NULL AND "__new_household_meal_ingredients"."base_unit_family_id" IS NULL) OR ("__new_household_meal_ingredients"."base_unit_id" IS NOT NULL AND "__new_household_meal_ingredients"."base_unit_family_id" IS NOT NULL)),
	CONSTRAINT "household_meal_ingredients_confidence_range" CHECK("__new_household_meal_ingredients"."confidence" IS NULL OR ("__new_household_meal_ingredients"."confidence" >= 0 AND "__new_household_meal_ingredients"."confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_household_meal_ingredients`("id", "household_meal_id", "line_index", "original_text", "source_amount_text", "source_quantity", "source_unit_label", "source_food_label", "base_food_id", "base_quantity", "base_unit_id", "base_unit_family_id", "optional", "confidence", "created_at") SELECT "id", "household_meal_id", "line_index", "original_text", "source_amount_text", "source_quantity", "source_unit_label", "source_food_label", "base_food_id", "base_quantity", "base_unit_id", "base_unit_family_id", "optional", "confidence", "created_at" FROM `household_meal_ingredients`;--> statement-breakpoint
DROP TABLE `household_meal_ingredients`;--> statement-breakpoint
ALTER TABLE `__new_household_meal_ingredients` RENAME TO `household_meal_ingredients`;--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_ingredients_meal_line_unique` ON `household_meal_ingredients` (`household_meal_id`,`line_index`);--> statement-breakpoint
CREATE INDEX `household_meal_ingredients_household_meal_id_idx` ON `household_meal_ingredients` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `household_meal_ingredients_meal_food_idx` ON `household_meal_ingredients` (`household_meal_id`,`base_food_id`);--> statement-breakpoint
CREATE INDEX `household_meal_ingredients_base_food_id_idx` ON `household_meal_ingredients` (`base_food_id`);--> statement-breakpoint
CREATE INDEX `household_meal_ingredients_base_unit_id_idx` ON `household_meal_ingredients` (`base_unit_id`);--> statement-breakpoint
CREATE TABLE `__new_household_meal_instruction_events` (
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
	CONSTRAINT "household_meal_instruction_events_unit_pair_check" CHECK(("__new_household_meal_instruction_events"."unit_id" IS NULL AND "__new_household_meal_instruction_events"."base_unit_id" IS NULL) OR ("__new_household_meal_instruction_events"."unit_id" IS NOT NULL AND "__new_household_meal_instruction_events"."base_unit_id" IS NOT NULL)),
	CONSTRAINT "household_meal_instruction_events_payload_check" CHECK((
	("__new_household_meal_instruction_events"."kind" = 'appliance' AND "__new_household_meal_instruction_events"."appliance" IS NOT NULL AND "__new_household_meal_instruction_events"."value" IS NULL AND "__new_household_meal_instruction_events"."unit_id" IS NULL AND "__new_household_meal_instruction_events"."base_value" IS NULL AND "__new_household_meal_instruction_events"."base_unit_id" IS NULL)
	OR ("__new_household_meal_instruction_events"."kind" IN ('temperature', 'duration') AND "__new_household_meal_instruction_events"."appliance" IS NULL AND "__new_household_meal_instruction_events"."value" IS NOT NULL AND "__new_household_meal_instruction_events"."unit_id" IS NOT NULL AND "__new_household_meal_instruction_events"."base_value" IS NOT NULL AND "__new_household_meal_instruction_events"."base_unit_id" IS NOT NULL)
	OR ("__new_household_meal_instruction_events"."kind" = 'action' AND "__new_household_meal_instruction_events"."appliance" IS NULL AND "__new_household_meal_instruction_events"."value" IS NULL AND "__new_household_meal_instruction_events"."unit_id" IS NULL AND "__new_household_meal_instruction_events"."base_value" IS NULL AND "__new_household_meal_instruction_events"."base_unit_id" IS NULL)
)),
	CONSTRAINT "household_meal_instruction_events_confidence_range" CHECK("__new_household_meal_instruction_events"."confidence" IS NULL OR ("__new_household_meal_instruction_events"."confidence" >= 0 AND "__new_household_meal_instruction_events"."confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_household_meal_instruction_events`("id", "household_meal_instruction_id", "kind", "appliance", "source_text", "value", "unit_id", "base_value", "base_unit_id", "confidence", "created_at") SELECT "id", "household_meal_instruction_id", "kind", "appliance", "source_text", "value", "unit_id", "base_value", "base_unit_id", "confidence", "created_at" FROM `household_meal_instruction_events`;--> statement-breakpoint
DROP TABLE `household_meal_instruction_events`;--> statement-breakpoint
ALTER TABLE `__new_household_meal_instruction_events` RENAME TO `household_meal_instruction_events`;--> statement-breakpoint
CREATE INDEX `household_meal_instruction_events_instruction_idx` ON `household_meal_instruction_events` (`household_meal_instruction_id`);--> statement-breakpoint
CREATE INDEX `household_meal_instruction_events_kind_idx` ON `household_meal_instruction_events` (`kind`);--> statement-breakpoint
CREATE TABLE `__new_household_meal_instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_meal_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`section_name` text,
	`text` text NOT NULL,
	`duration_minutes` integer,
	`confidence` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "household_meal_instructions_confidence_range" CHECK("__new_household_meal_instructions"."confidence" IS NULL OR ("__new_household_meal_instructions"."confidence" >= 0 AND "__new_household_meal_instructions"."confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_household_meal_instructions`("id", "household_meal_id", "step_index", "section_name", "text", "duration_minutes", "confidence", "created_at", "updated_at") SELECT "id", "household_meal_id", "step_index", "section_name", "text", "duration_minutes", "confidence", "created_at", "updated_at" FROM `household_meal_instructions`;--> statement-breakpoint
DROP TABLE `household_meal_instructions`;--> statement-breakpoint
ALTER TABLE `__new_household_meal_instructions` RENAME TO `household_meal_instructions`;--> statement-breakpoint
CREATE UNIQUE INDEX `household_meal_instructions_meal_step_unique` ON `household_meal_instructions` (`household_meal_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `household_meal_instructions_household_meal_id_idx` ON `household_meal_instructions` (`household_meal_id`);--> statement-breakpoint
CREATE TABLE `__new_household_meal_media` (
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
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "household_meal_media_payload_check" CHECK("__new_household_meal_media"."url" IS NOT NULL OR "__new_household_meal_media"."content_url" IS NOT NULL OR "__new_household_meal_media"."embed_url" IS NOT NULL OR "__new_household_meal_media"."thumbnail_url" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_household_meal_media`("id", "household_meal_id", "kind", "position", "url", "content_url", "embed_url", "thumbnail_url", "name", "caption", "created_at") SELECT "id", "household_meal_id", "kind", "position", "url", "content_url", "embed_url", "thumbnail_url", "name", "caption", "created_at" FROM `household_meal_media`;--> statement-breakpoint
DROP TABLE `household_meal_media`;--> statement-breakpoint
ALTER TABLE `__new_household_meal_media` RENAME TO `household_meal_media`;--> statement-breakpoint
CREATE INDEX `household_meal_media_meal_id_idx` ON `household_meal_media` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `household_meal_media_kind_idx` ON `household_meal_media` (`kind`);--> statement-breakpoint
CREATE TABLE `__new_household_meals` (
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
	FOREIGN KEY (`planned_cook_workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "household_meals_parse_confidence_range" CHECK("__new_household_meals"."parse_confidence" IS NULL OR ("__new_household_meals"."parse_confidence" >= 0 AND "__new_household_meals"."parse_confidence" <= 1)),
	CONSTRAINT "household_meals_ingredient_confidence_range" CHECK("__new_household_meals"."ingredient_confidence" IS NULL OR ("__new_household_meals"."ingredient_confidence" >= 0 AND "__new_household_meals"."ingredient_confidence" <= 1)),
	CONSTRAINT "household_meals_instruction_confidence_range" CHECK("__new_household_meals"."instruction_confidence" IS NULL OR ("__new_household_meals"."instruction_confidence" >= 0 AND "__new_household_meals"."instruction_confidence" <= 1)),
	CONSTRAINT "household_meals_nutrition_confidence_range" CHECK("__new_household_meals"."nutrition_confidence" IS NULL OR ("__new_household_meals"."nutrition_confidence" >= 0 AND "__new_household_meals"."nutrition_confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_household_meals`("id", "household_id", "title", "description", "image_url", "date", "time", "status", "prep_time_minutes", "cook_time_minutes", "total_time_minutes", "yield", "planned_yield", "planned_cook_workos_user_id", "sort_order", "source_yield_text", "source_date_published", "source_date_modified", "source_language", "source_url", "source_site_name", "source_author_name", "source_publisher_name", "source_is_based_on_url", "source_imported_at", "source_html_hash", "source_rating_value", "source_rating_count", "source_review_count", "source_claimed_minutes", "parse_confidence", "ingredient_confidence", "instruction_confidence", "nutrition_confidence", "notes", "created_at", "updated_at") SELECT "id", "household_id", "title", "description", "image_url", "date", "time", "status", "prep_time_minutes", "cook_time_minutes", "total_time_minutes", "yield", "planned_yield", "planned_cook_workos_user_id", "sort_order", "source_yield_text", "source_date_published", "source_date_modified", "source_language", "source_url", "source_site_name", "source_author_name", "source_publisher_name", "source_is_based_on_url", "source_imported_at", "source_html_hash", "source_rating_value", "source_rating_count", "source_review_count", "source_claimed_minutes", "parse_confidence", "ingredient_confidence", "instruction_confidence", "nutrition_confidence", "notes", "created_at", "updated_at" FROM `household_meals`;--> statement-breakpoint
DROP TABLE `household_meals`;--> statement-breakpoint
ALTER TABLE `__new_household_meals` RENAME TO `household_meals`;--> statement-breakpoint
CREATE INDEX `household_meals_household_id_idx` ON `household_meals` (`household_id`);--> statement-breakpoint
CREATE INDEX `household_meals_household_status_idx` ON `household_meals` (`household_id`,`status`);--> statement-breakpoint
CREATE INDEX `household_meals_household_date_time_idx` ON `household_meals` (`household_id`,`date`,`time`);--> statement-breakpoint
CREATE INDEX `household_meals_household_floating_sort_idx` ON `household_meals` (`household_id`,`date`,`sort_order`);--> statement-breakpoint
CREATE INDEX `household_meals_planned_cook_idx` ON `household_meals` (`planned_cook_workos_user_id`);--> statement-breakpoint
CREATE INDEX `household_meals_sort_order_idx` ON `household_meals` (`sort_order`);--> statement-breakpoint
CREATE TABLE `__new_user_recipe_appliance_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_id` text NOT NULL,
	`appliance` text NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'instruction_heuristic' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_recipe_appliance_requirements_confidence_range" CHECK("__new_user_recipe_appliance_requirements"."confidence" IS NULL OR ("__new_user_recipe_appliance_requirements"."confidence" >= 0 AND "__new_user_recipe_appliance_requirements"."confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_user_recipe_appliance_requirements`("id", "user_recipe_id", "appliance", "required", "source", "confidence", "notes", "created_at", "updated_at") SELECT "id", "user_recipe_id", "appliance", "required", "source", "confidence", "notes", "created_at", "updated_at" FROM `user_recipe_appliance_requirements`;--> statement-breakpoint
DROP TABLE `user_recipe_appliance_requirements`;--> statement-breakpoint
ALTER TABLE `__new_user_recipe_appliance_requirements` RENAME TO `user_recipe_appliance_requirements`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_recipe_appliance_requirements_recipe_appliance_unique` ON `user_recipe_appliance_requirements` (`user_recipe_id`,`appliance`);--> statement-breakpoint
CREATE INDEX `user_recipe_appliance_requirements_user_recipe_id_idx` ON `user_recipe_appliance_requirements` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_appliance_requirements_appliance_idx` ON `user_recipe_appliance_requirements` (`appliance`);--> statement-breakpoint
CREATE TABLE `__new_user_recipe_ingredients` (
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
	CONSTRAINT "user_recipe_ingredients_base_unit_pair_check" CHECK(("__new_user_recipe_ingredients"."base_unit_id" IS NULL AND "__new_user_recipe_ingredients"."base_unit_family_id" IS NULL) OR ("__new_user_recipe_ingredients"."base_unit_id" IS NOT NULL AND "__new_user_recipe_ingredients"."base_unit_family_id" IS NOT NULL)),
	CONSTRAINT "user_recipe_ingredients_confidence_range" CHECK("__new_user_recipe_ingredients"."confidence" IS NULL OR ("__new_user_recipe_ingredients"."confidence" >= 0 AND "__new_user_recipe_ingredients"."confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_user_recipe_ingredients`("id", "user_recipe_id", "line_index", "original_text", "source_amount_text", "source_quantity", "source_unit_label", "source_food_label", "base_food_id", "base_quantity", "base_unit_id", "base_unit_family_id", "optional", "confidence", "created_at") SELECT "id", "user_recipe_id", "line_index", "original_text", "source_amount_text", "source_quantity", "source_unit_label", "source_food_label", "base_food_id", "base_quantity", "base_unit_id", "base_unit_family_id", "optional", "confidence", "created_at" FROM `user_recipe_ingredients`;--> statement-breakpoint
DROP TABLE `user_recipe_ingredients`;--> statement-breakpoint
ALTER TABLE `__new_user_recipe_ingredients` RENAME TO `user_recipe_ingredients`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_recipe_ingredients_recipe_line_unique` ON `user_recipe_ingredients` (`user_recipe_id`,`line_index`);--> statement-breakpoint
CREATE INDEX `user_recipe_ingredients_user_recipe_id_idx` ON `user_recipe_ingredients` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_ingredients_recipe_food_idx` ON `user_recipe_ingredients` (`user_recipe_id`,`base_food_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_ingredients_base_food_id_idx` ON `user_recipe_ingredients` (`base_food_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_ingredients_base_unit_id_idx` ON `user_recipe_ingredients` (`base_unit_id`);--> statement-breakpoint
CREATE TABLE `__new_user_recipe_instruction_events` (
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
	CONSTRAINT "user_recipe_instruction_events_unit_pair_check" CHECK(("__new_user_recipe_instruction_events"."unit_id" IS NULL AND "__new_user_recipe_instruction_events"."base_unit_id" IS NULL) OR ("__new_user_recipe_instruction_events"."unit_id" IS NOT NULL AND "__new_user_recipe_instruction_events"."base_unit_id" IS NOT NULL)),
	CONSTRAINT "user_recipe_instruction_events_payload_check" CHECK((
	("__new_user_recipe_instruction_events"."kind" = 'appliance' AND "__new_user_recipe_instruction_events"."appliance" IS NOT NULL AND "__new_user_recipe_instruction_events"."value" IS NULL AND "__new_user_recipe_instruction_events"."unit_id" IS NULL AND "__new_user_recipe_instruction_events"."base_value" IS NULL AND "__new_user_recipe_instruction_events"."base_unit_id" IS NULL)
	OR ("__new_user_recipe_instruction_events"."kind" IN ('temperature', 'duration') AND "__new_user_recipe_instruction_events"."appliance" IS NULL AND "__new_user_recipe_instruction_events"."value" IS NOT NULL AND "__new_user_recipe_instruction_events"."unit_id" IS NOT NULL AND "__new_user_recipe_instruction_events"."base_value" IS NOT NULL AND "__new_user_recipe_instruction_events"."base_unit_id" IS NOT NULL)
	OR ("__new_user_recipe_instruction_events"."kind" = 'action' AND "__new_user_recipe_instruction_events"."appliance" IS NULL AND "__new_user_recipe_instruction_events"."value" IS NULL AND "__new_user_recipe_instruction_events"."unit_id" IS NULL AND "__new_user_recipe_instruction_events"."base_value" IS NULL AND "__new_user_recipe_instruction_events"."base_unit_id" IS NULL)
)),
	CONSTRAINT "user_recipe_instruction_events_confidence_range" CHECK("__new_user_recipe_instruction_events"."confidence" IS NULL OR ("__new_user_recipe_instruction_events"."confidence" >= 0 AND "__new_user_recipe_instruction_events"."confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_user_recipe_instruction_events`("id", "user_recipe_instruction_id", "kind", "appliance", "source_text", "value", "unit_id", "base_value", "base_unit_id", "confidence", "created_at") SELECT "id", "user_recipe_instruction_id", "kind", "appliance", "source_text", "value", "unit_id", "base_value", "base_unit_id", "confidence", "created_at" FROM `user_recipe_instruction_events`;--> statement-breakpoint
DROP TABLE `user_recipe_instruction_events`;--> statement-breakpoint
ALTER TABLE `__new_user_recipe_instruction_events` RENAME TO `user_recipe_instruction_events`;--> statement-breakpoint
CREATE INDEX `user_recipe_instruction_events_instruction_idx` ON `user_recipe_instruction_events` (`user_recipe_instruction_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_instruction_events_kind_idx` ON `user_recipe_instruction_events` (`kind`);--> statement-breakpoint
CREATE TABLE `__new_user_recipe_instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_recipe_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`section_name` text,
	`text` text NOT NULL,
	`duration_minutes` integer,
	`confidence` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_recipe_instructions_confidence_range" CHECK("__new_user_recipe_instructions"."confidence" IS NULL OR ("__new_user_recipe_instructions"."confidence" >= 0 AND "__new_user_recipe_instructions"."confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_user_recipe_instructions`("id", "user_recipe_id", "step_index", "section_name", "text", "duration_minutes", "confidence", "created_at", "updated_at") SELECT "id", "user_recipe_id", "step_index", "section_name", "text", "duration_minutes", "confidence", "created_at", "updated_at" FROM `user_recipe_instructions`;--> statement-breakpoint
DROP TABLE `user_recipe_instructions`;--> statement-breakpoint
ALTER TABLE `__new_user_recipe_instructions` RENAME TO `user_recipe_instructions`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_recipe_instructions_recipe_step_unique` ON `user_recipe_instructions` (`user_recipe_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `user_recipe_instructions_user_recipe_id_idx` ON `user_recipe_instructions` (`user_recipe_id`);--> statement-breakpoint
CREATE TABLE `__new_user_recipe_media` (
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
	FOREIGN KEY (`user_recipe_id`) REFERENCES `user_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_recipe_media_payload_check" CHECK("__new_user_recipe_media"."url" IS NOT NULL OR "__new_user_recipe_media"."content_url" IS NOT NULL OR "__new_user_recipe_media"."embed_url" IS NOT NULL OR "__new_user_recipe_media"."thumbnail_url" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_user_recipe_media`("id", "user_recipe_id", "kind", "position", "url", "content_url", "embed_url", "thumbnail_url", "name", "caption", "created_at") SELECT "id", "user_recipe_id", "kind", "position", "url", "content_url", "embed_url", "thumbnail_url", "name", "caption", "created_at" FROM `user_recipe_media`;--> statement-breakpoint
DROP TABLE `user_recipe_media`;--> statement-breakpoint
ALTER TABLE `__new_user_recipe_media` RENAME TO `user_recipe_media`;--> statement-breakpoint
CREATE INDEX `user_recipe_media_recipe_id_idx` ON `user_recipe_media` (`user_recipe_id`);--> statement-breakpoint
CREATE INDEX `user_recipe_media_kind_idx` ON `user_recipe_media` (`kind`);--> statement-breakpoint
CREATE TABLE `__new_user_recipes` (
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
	FOREIGN KEY (`saved_from_household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "user_recipes_parse_confidence_range" CHECK("__new_user_recipes"."parse_confidence" IS NULL OR ("__new_user_recipes"."parse_confidence" >= 0 AND "__new_user_recipes"."parse_confidence" <= 1)),
	CONSTRAINT "user_recipes_ingredient_confidence_range" CHECK("__new_user_recipes"."ingredient_confidence" IS NULL OR ("__new_user_recipes"."ingredient_confidence" >= 0 AND "__new_user_recipes"."ingredient_confidence" <= 1)),
	CONSTRAINT "user_recipes_instruction_confidence_range" CHECK("__new_user_recipes"."instruction_confidence" IS NULL OR ("__new_user_recipes"."instruction_confidence" >= 0 AND "__new_user_recipes"."instruction_confidence" <= 1)),
	CONSTRAINT "user_recipes_nutrition_confidence_range" CHECK("__new_user_recipes"."nutrition_confidence" IS NULL OR ("__new_user_recipes"."nutrition_confidence" >= 0 AND "__new_user_recipes"."nutrition_confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_user_recipes`("id", "workos_user_id", "saved_from_household_id", "title", "description", "image_url", "prep_time_minutes", "cook_time_minutes", "total_time_minutes", "yield", "source_yield_text", "source_date_published", "source_date_modified", "source_language", "source_url", "source_site_name", "source_author_name", "source_publisher_name", "source_is_based_on_url", "source_imported_at", "source_html_hash", "source_rating_value", "source_rating_count", "source_review_count", "source_claimed_minutes", "parse_confidence", "ingredient_confidence", "instruction_confidence", "nutrition_confidence", "user_notes", "deleted_at", "created_at", "updated_at") SELECT "id", "workos_user_id", "saved_from_household_id", "title", "description", "image_url", "prep_time_minutes", "cook_time_minutes", "total_time_minutes", "yield", "source_yield_text", "source_date_published", "source_date_modified", "source_language", "source_url", "source_site_name", "source_author_name", "source_publisher_name", "source_is_based_on_url", "source_imported_at", "source_html_hash", "source_rating_value", "source_rating_count", "source_review_count", "source_claimed_minutes", "parse_confidence", "ingredient_confidence", "instruction_confidence", "nutrition_confidence", "user_notes", "deleted_at", "created_at", "updated_at" FROM `user_recipes`;--> statement-breakpoint
DROP TABLE `user_recipes`;--> statement-breakpoint
ALTER TABLE `__new_user_recipes` RENAME TO `user_recipes`;--> statement-breakpoint
CREATE INDEX `user_recipes_workos_user_id_idx` ON `user_recipes` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `user_recipes_user_visible_idx` ON `user_recipes` (`workos_user_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `user_recipes_saved_from_household_id_idx` ON `user_recipes` (`saved_from_household_id`);--> statement-breakpoint
CREATE INDEX `user_recipes_source_url_idx` ON `user_recipes` (`source_url`);--> statement-breakpoint
CREATE INDEX `user_recipes_source_html_hash_idx` ON `user_recipes` (`source_html_hash`);--> statement-breakpoint
CREATE INDEX `user_recipes_deleted_at_idx` ON `user_recipes` (`deleted_at`);PRAGMA foreign_key_check;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
