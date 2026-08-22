PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_meal_check_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`reporter_user_id` text NOT NULL,
	`meal_id` text,
	`cook_time_minutes` integer,
	`verdict` text NOT NULL,
	`reason` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meal_check_ins_verdict_check" CHECK("__new_meal_check_ins"."verdict" IN ('repeat', 'neutral', 'avoid')),
	CONSTRAINT "meal_check_ins_cook_time_positive" CHECK("__new_meal_check_ins"."cook_time_minutes" IS NULL OR "__new_meal_check_ins"."cook_time_minutes" > 0),
	CONSTRAINT "meal_check_ins_revision_positive" CHECK("__new_meal_check_ins"."revision" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_meal_check_ins`("id", "household_id", "reporter_user_id", "meal_id", "cook_time_minutes", "verdict", "reason", "schema_version", "revision", "created_at", "updated_at", "deleted_at") SELECT "id", "household_id", "reporter_user_id", "meal_id", "cook_time_minutes", "verdict", "reason", "schema_version", "revision", "created_at", "updated_at", "deleted_at" FROM `meal_check_ins`;--> statement-breakpoint
DROP TABLE `meal_check_ins`;--> statement-breakpoint
ALTER TABLE `__new_meal_check_ins` RENAME TO `meal_check_ins`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `meal_check_ins_meal_reporter_unique` ON `meal_check_ins` (`meal_id`,`reporter_user_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_household_idx` ON `meal_check_ins` (`household_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_reporter_idx` ON `meal_check_ins` (`reporter_user_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_deleted_idx` ON `meal_check_ins` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `__new_meals` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text,
	`source_recipe_id` text,
	`title` text NOT NULL,
	`description` text,
	`image_url` text,
	`date` text,
	`time` text,
	`sort_order` integer,
	`planned_cook_user_id` text,
	`yield` real,
	`planned_yield` integer,
	`status` text DEFAULT 'planned' NOT NULL,
	`prep_time_minutes` integer,
	`cook_time_minutes` integer,
	`total_time_minutes` integer,
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
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`planned_cook_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meals_status_check" CHECK("__new_meals"."status" IN ('planned', 'cooked', 'skipped')),
	CONSTRAINT "meals_revision_positive" CHECK("__new_meals"."revision" > 0),
	CONSTRAINT "meals_sort_order_nonnegative" CHECK("__new_meals"."sort_order" IS NULL OR "__new_meals"."sort_order" >= 0),
	CONSTRAINT "meals_planned_yield_positive" CHECK("__new_meals"."planned_yield" IS NULL OR "__new_meals"."planned_yield" > 0),
	CONSTRAINT "meals_parse_confidence_range" CHECK("__new_meals"."parse_confidence" IS NULL OR ("__new_meals"."parse_confidence" >= 0 AND "__new_meals"."parse_confidence" <= 1)),
	CONSTRAINT "meals_ingredient_confidence_range" CHECK("__new_meals"."ingredient_confidence" IS NULL OR ("__new_meals"."ingredient_confidence" >= 0 AND "__new_meals"."ingredient_confidence" <= 1)),
	CONSTRAINT "meals_instruction_confidence_range" CHECK("__new_meals"."instruction_confidence" IS NULL OR ("__new_meals"."instruction_confidence" >= 0 AND "__new_meals"."instruction_confidence" <= 1)),
	CONSTRAINT "meals_nutrition_confidence_range" CHECK("__new_meals"."nutrition_confidence" IS NULL OR ("__new_meals"."nutrition_confidence" >= 0 AND "__new_meals"."nutrition_confidence" <= 1))
);
--> statement-breakpoint
INSERT INTO `__new_meals`("id", "household_id", "source_recipe_id", "title", "description", "image_url", "date", "time", "sort_order", "planned_cook_user_id", "yield", "planned_yield", "status", "prep_time_minutes", "cook_time_minutes", "total_time_minutes", "source_yield_text", "source_date_published", "source_date_modified", "source_language", "source_url", "source_site_name", "source_author_name", "source_publisher_name", "source_is_based_on_url", "source_imported_at", "source_html_hash", "source_rating_value", "source_rating_count", "source_review_count", "source_claimed_minutes", "parse_confidence", "ingredient_confidence", "instruction_confidence", "nutrition_confidence", "notes", "schema_version", "revision", "created_at", "updated_at", "deleted_at") SELECT "id", "household_id", "source_recipe_id", "title", "description", "image_url", "date", "time", "sort_order", "planned_cook_user_id", "yield", "planned_yield", "status", "prep_time_minutes", "cook_time_minutes", "total_time_minutes", "source_yield_text", "source_date_published", "source_date_modified", "source_language", "source_url", "source_site_name", "source_author_name", "source_publisher_name", "source_is_based_on_url", "source_imported_at", "source_html_hash", "source_rating_value", "source_rating_count", "source_review_count", "source_claimed_minutes", "parse_confidence", "ingredient_confidence", "instruction_confidence", "nutrition_confidence", "notes", "schema_version", "revision", "created_at", "updated_at", "deleted_at" FROM `meals`;--> statement-breakpoint
DROP TABLE `meals`;--> statement-breakpoint
ALTER TABLE `__new_meals` RENAME TO `meals`;--> statement-breakpoint
CREATE INDEX `meals_household_date_sort_idx` ON `meals` (`household_id`,`date`,`sort_order`);--> statement-breakpoint
CREATE INDEX `meals_household_status_idx` ON `meals` (`household_id`,`status`);--> statement-breakpoint
CREATE INDEX `meals_source_recipe_idx` ON `meals` (`source_recipe_id`);--> statement-breakpoint
CREATE INDEX `meals_planned_cook_idx` ON `meals` (`planned_cook_user_id`);--> statement-breakpoint
CREATE INDEX `meals_updated_idx` ON `meals` (`updated_at`);--> statement-breakpoint
ALTER TABLE `sync_entity_versions` ADD `winning_actor_user_id` text;--> statement-breakpoint
ALTER TABLE `sync_entity_versions` ADD `winning_received_at` text;--> statement-breakpoint
UPDATE `sync_entity_versions`
SET `winning_actor_user_id` = (
		SELECT `actor_user_id` FROM `sync_changes`
		WHERE `sync_changes`.`seq` = `sync_entity_versions`.`last_sequence`
	),
	`winning_received_at` = (
		SELECT `received_at` FROM `sync_changes`
		WHERE `sync_changes`.`seq` = `sync_entity_versions`.`last_sequence`
	);
