CREATE TABLE `household_appliances` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`appliance` text NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`notes` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "household_appliances_appliance_check" CHECK("household_appliances"."appliance" IN ('oven', 'stovetop', 'microwave', 'air_fryer', 'slow_cooker', 'rice_cooker', 'blender', 'food_processor', 'grill'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_appliances_household_appliance_unique` ON `household_appliances` (`household_id`,`appliance`);--> statement-breakpoint
CREATE INDEX `household_appliances_household_idx` ON `household_appliances` (`household_id`);--> statement-breakpoint
CREATE TABLE `household_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`role_slug` text DEFAULT 'member' NOT NULL,
	`max_uses` integer,
	`uses_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "household_invites_role_check" CHECK("household_invites"."role_slug" IN ('admin', 'member', 'child')),
	CONSTRAINT "household_invites_max_uses_range" CHECK("household_invites"."max_uses" IS NULL OR ("household_invites"."max_uses" >= 1 AND "household_invites"."max_uses" <= 100)),
	CONSTRAINT "household_invites_uses_count_nonnegative" CHECK("household_invites"."uses_count" >= 0),
	CONSTRAINT "household_invites_uses_within_limit" CHECK("household_invites"."max_uses" IS NULL OR "household_invites"."uses_count" <= "household_invites"."max_uses")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_invites_code_hash_unique` ON `household_invites` (`code_hash`);--> statement-breakpoint
CREATE INDEX `household_invites_household_idx` ON `household_invites` (`household_id`);--> statement-breakpoint
CREATE INDEX `household_invites_expiry_idx` ON `household_invites` (`expires_at`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `household_membership_mutation_locks` (
	`household_id` text PRIMARY KEY NOT NULL,
	`owner_token` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `household_memberships` (
	`membership_id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`workos_user_id` text NOT NULL,
	`role_slug` text NOT NULL,
	`permissions` text NOT NULL,
	`status` text NOT NULL,
	`directory_managed` integer DEFAULT false NOT NULL,
	`workos_created_at` text NOT NULL,
	`last_verified_at` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "household_memberships_role_check" CHECK("household_memberships"."role_slug" IN ('admin', 'member', 'child')),
	CONSTRAINT "household_memberships_permissions_json_check" CHECK(json_valid("household_memberships"."permissions"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_memberships_household_user_unique` ON `household_memberships` (`household_id`,`workos_user_id`);--> statement-breakpoint
CREATE INDEX `household_memberships_user_status_idx` ON `household_memberships` (`workos_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `household_memberships_household_status_idx` ON `household_memberships` (`household_id`,`status`);--> statement-breakpoint
CREATE TABLE `households` (
	`household_id` text PRIMARY KEY NOT NULL,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`timezone` text,
	`week_starts_on` integer DEFAULT 1 NOT NULL,
	`default_planned_yield` integer DEFAULT 1 NOT NULL,
	`preferred_dinner_time` text,
	`created_by_user_id` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "households_week_starts_on_range" CHECK("households"."week_starts_on" IN (0, 1)),
	CONSTRAINT "households_default_planned_yield_positive" CHECK("households"."default_planned_yield" > 0)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`workos_user_id` text PRIMARY KEY NOT NULL,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`timezone` text,
	`cached_cook_time_coefficient` real DEFAULT 1 NOT NULL,
	`cook_time_coefficient_updated_at` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `meal_appliance_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_id` text NOT NULL,
	`appliance` text NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'instruction_heuristic' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meal_appliance_requirements_appliance_check" CHECK("meal_appliance_requirements"."appliance" IN ('oven', 'stovetop', 'microwave', 'air_fryer', 'slow_cooker', 'rice_cooker', 'blender', 'food_processor', 'grill')),
	CONSTRAINT "meal_appliance_requirements_source_check" CHECK("meal_appliance_requirements"."source" IN ('schema_org', 'instruction_heuristic', 'user')),
	CONSTRAINT "meal_appliance_requirements_confidence_range" CHECK("meal_appliance_requirements"."confidence" IS NULL OR ("meal_appliance_requirements"."confidence" >= 0 AND "meal_appliance_requirements"."confidence" <= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_appliance_requirements_unique` ON `meal_appliance_requirements` (`meal_id`,`appliance`);--> statement-breakpoint
CREATE TABLE `meal_check_ins` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meal_check_ins_verdict_check" CHECK("meal_check_ins"."verdict" IN ('repeat', 'neutral', 'avoid')),
	CONSTRAINT "meal_check_ins_cook_time_positive" CHECK("meal_check_ins"."cook_time_minutes" IS NULL OR "meal_check_ins"."cook_time_minutes" > 0),
	CONSTRAINT "meal_check_ins_revision_positive" CHECK("meal_check_ins"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_check_ins_meal_reporter_unique` ON `meal_check_ins` (`meal_id`,`reporter_user_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_reporter_idx` ON `meal_check_ins` (`reporter_user_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_deleted_idx` ON `meal_check_ins` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `meal_classifications` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`schema_org_value` text,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meal_classifications_kind_check" CHECK("meal_classifications"."kind" IN ('category', 'cuisine', 'keyword', 'diet')),
	CONSTRAINT "meal_classifications_confidence_range" CHECK("meal_classifications"."confidence" IS NULL OR ("meal_classifications"."confidence" >= 0 AND "meal_classifications"."confidence" <= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_classifications_unique` ON `meal_classifications` (`meal_id`,`kind`,`normalized_value`,`locale`);--> statement-breakpoint
CREATE TABLE `meal_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_id` text NOT NULL,
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
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`base_unit_id`,`base_unit_family_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meal_ingredients_line_nonnegative" CHECK("meal_ingredients"."line_index" >= 0),
	CONSTRAINT "meal_ingredients_base_unit_pair_check" CHECK((("meal_ingredients"."base_unit_id" IS NULL AND "meal_ingredients"."base_unit_family_id" IS NULL) OR ("meal_ingredients"."base_unit_id" IS NOT NULL AND "meal_ingredients"."base_unit_family_id" IS NOT NULL))),
	CONSTRAINT "meal_ingredients_confidence_range" CHECK("meal_ingredients"."confidence" IS NULL OR ("meal_ingredients"."confidence" >= 0 AND "meal_ingredients"."confidence" <= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_ingredients_meal_line_unique` ON `meal_ingredients` (`meal_id`,`line_index`);--> statement-breakpoint
CREATE INDEX `meal_ingredients_meal_idx` ON `meal_ingredients` (`meal_id`);--> statement-breakpoint
CREATE TABLE `meal_instruction_events` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_instruction_id` text NOT NULL,
	`kind` text NOT NULL,
	`appliance` text,
	`source_text` text NOT NULL,
	`value` real,
	`unit_id` text,
	`base_value` real,
	`base_unit_id` text,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`meal_instruction_id`) REFERENCES `meal_instructions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meal_instruction_events_kind_check" CHECK("meal_instruction_events"."kind" IN ('temperature', 'duration', 'appliance', 'action')),
	CONSTRAINT "meal_instruction_events_appliance_check" CHECK("meal_instruction_events"."appliance" IS NULL OR "meal_instruction_events"."appliance" IN ('oven', 'stovetop', 'microwave', 'air_fryer', 'slow_cooker', 'rice_cooker', 'blender', 'food_processor', 'grill')),
	CONSTRAINT "meal_instruction_events_unit_pair_check" CHECK((("meal_instruction_events"."unit_id" IS NULL AND "meal_instruction_events"."base_unit_id" IS NULL) OR ("meal_instruction_events"."unit_id" IS NOT NULL AND "meal_instruction_events"."base_unit_id" IS NOT NULL))),
	CONSTRAINT "meal_instruction_events_payload_check" CHECK((
	("meal_instruction_events"."kind" = 'appliance' AND "meal_instruction_events"."appliance" IS NOT NULL AND "meal_instruction_events"."value" IS NULL AND "meal_instruction_events"."unit_id" IS NULL AND "meal_instruction_events"."base_value" IS NULL AND "meal_instruction_events"."base_unit_id" IS NULL)
	OR ("meal_instruction_events"."kind" IN ('temperature', 'duration') AND "meal_instruction_events"."appliance" IS NULL AND "meal_instruction_events"."value" IS NOT NULL AND "meal_instruction_events"."unit_id" IS NOT NULL AND "meal_instruction_events"."base_value" IS NOT NULL AND "meal_instruction_events"."base_unit_id" IS NOT NULL)
	OR ("meal_instruction_events"."kind" = 'action' AND "meal_instruction_events"."appliance" IS NULL AND "meal_instruction_events"."value" IS NULL AND "meal_instruction_events"."unit_id" IS NULL AND "meal_instruction_events"."base_value" IS NULL AND "meal_instruction_events"."base_unit_id" IS NULL)
)),
	CONSTRAINT "meal_instruction_events_confidence_range" CHECK("meal_instruction_events"."confidence" IS NULL OR ("meal_instruction_events"."confidence" >= 0 AND "meal_instruction_events"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE `meal_instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`section_name` text,
	`text` text NOT NULL,
	`duration_minutes` integer,
	`confidence` real,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meal_instructions_step_nonnegative" CHECK("meal_instructions"."step_index" >= 0),
	CONSTRAINT "meal_instructions_confidence_range" CHECK("meal_instructions"."confidence" IS NULL OR ("meal_instructions"."confidence" >= 0 AND "meal_instructions"."confidence" <= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_instructions_meal_step_unique` ON `meal_instructions` (`meal_id`,`step_index`);--> statement-breakpoint
CREATE TABLE `meal_media` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_id` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`url` text,
	`content_url` text,
	`embed_url` text,
	`thumbnail_url` text,
	`name` text,
	`caption` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meal_media_kind_check" CHECK("meal_media"."kind" IN ('image', 'video')),
	CONSTRAINT "meal_media_position_nonnegative" CHECK("meal_media"."position" >= 0),
	CONSTRAINT "meal_media_payload_check" CHECK("meal_media"."url" IS NOT NULL OR "meal_media"."content_url" IS NOT NULL OR "meal_media"."embed_url" IS NOT NULL OR "meal_media"."thumbnail_url" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_media_position_unique` ON `meal_media` (`meal_id`,`position`);--> statement-breakpoint
CREATE TABLE `meal_nutrition_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_id` text NOT NULL,
	`nutrient` text NOT NULL,
	`schema_org_property` text NOT NULL,
	`original_text` text NOT NULL,
	`amount` real,
	`unit_id` text,
	`base_amount` real,
	`base_unit_id` text,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meal_nutrition_facts_nutrient_check" CHECK("meal_nutrition_facts"."nutrient" IN ('calories', 'carbohydrate', 'cholesterol', 'fat', 'fiber', 'protein', 'saturated_fat', 'serving_size', 'sodium', 'sugar', 'trans_fat', 'unsaturated_fat', 'other')),
	CONSTRAINT "meal_nutrition_facts_unit_pair_check" CHECK((("meal_nutrition_facts"."unit_id" IS NULL AND "meal_nutrition_facts"."base_unit_id" IS NULL) OR ("meal_nutrition_facts"."unit_id" IS NOT NULL AND "meal_nutrition_facts"."base_unit_id" IS NOT NULL))),
	CONSTRAINT "meal_nutrition_facts_confidence_range" CHECK("meal_nutrition_facts"."confidence" IS NULL OR ("meal_nutrition_facts"."confidence" >= 0 AND "meal_nutrition_facts"."confidence" <= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_nutrition_facts_unique` ON `meal_nutrition_facts` (`meal_id`,`schema_org_property`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
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
	CONSTRAINT "meals_status_check" CHECK("meals"."status" IN ('planned', 'cooked', 'skipped')),
	CONSTRAINT "meals_revision_positive" CHECK("meals"."revision" > 0),
	CONSTRAINT "meals_sort_order_nonnegative" CHECK("meals"."sort_order" IS NULL OR "meals"."sort_order" >= 0),
	CONSTRAINT "meals_planned_yield_positive" CHECK("meals"."planned_yield" IS NULL OR "meals"."planned_yield" > 0),
	CONSTRAINT "meals_parse_confidence_range" CHECK("meals"."parse_confidence" IS NULL OR ("meals"."parse_confidence" >= 0 AND "meals"."parse_confidence" <= 1)),
	CONSTRAINT "meals_ingredient_confidence_range" CHECK("meals"."ingredient_confidence" IS NULL OR ("meals"."ingredient_confidence" >= 0 AND "meals"."ingredient_confidence" <= 1)),
	CONSTRAINT "meals_instruction_confidence_range" CHECK("meals"."instruction_confidence" IS NULL OR ("meals"."instruction_confidence" >= 0 AND "meals"."instruction_confidence" <= 1)),
	CONSTRAINT "meals_nutrition_confidence_range" CHECK("meals"."nutrition_confidence" IS NULL OR ("meals"."nutrition_confidence" >= 0 AND "meals"."nutrition_confidence" <= 1))
);
--> statement-breakpoint
CREATE INDEX `meals_household_date_sort_idx` ON `meals` (`household_id`,`date`,`sort_order`);--> statement-breakpoint
CREATE INDEX `meals_household_status_idx` ON `meals` (`household_id`,`status`);--> statement-breakpoint
CREATE INDEX `meals_source_recipe_idx` ON `meals` (`source_recipe_id`);--> statement-breakpoint
CREATE INDEX `meals_planned_cook_idx` ON `meals` (`planned_cook_user_id`);--> statement-breakpoint
CREATE INDEX `meals_updated_idx` ON `meals` (`updated_at`);--> statement-breakpoint
CREATE TABLE `billing_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`household_id` text,
	`actor_user_id` text,
	`event_type` text NOT NULL,
	`safe_details` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL,
	CONSTRAINT "billing_audit_events_safe_details_json_check" CHECK(json_valid("billing_audit_events"."safe_details"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_audit_events_idempotency_unique` ON `billing_audit_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `billing_audit_events_household_time_idx` ON `billing_audit_events` (`household_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `billing_subscriptions` (
	`household_id` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`stripe_price_id` text NOT NULL,
	`subscriber_user_id` text,
	`status` text NOT NULL,
	`current_period_end` text NOT NULL,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`interruption_started_at` text,
	`grace_until` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscriber_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "billing_subscriptions_status_check" CHECK("billing_subscriptions"."status" IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_subscription_unique` ON `billing_subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `billing_subscriptions_customer_idx` ON `billing_subscriptions` (`stripe_customer_id`);--> statement-breakpoint
CREATE INDEX `billing_subscriptions_subscriber_idx` ON `billing_subscriptions` (`subscriber_user_id`);--> statement-breakpoint
CREATE TABLE `billing_trial_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`household_id` text NOT NULL,
	`state` text NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`reserved_at` text NOT NULL,
	`started_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "billing_trial_claims_state_check" CHECK("billing_trial_claims"."state" IN ('reserved', 'started', 'rollback_pending')),
	CONSTRAINT "billing_trial_claims_started_at_check" CHECK("billing_trial_claims"."state" != 'started' OR "billing_trial_claims"."started_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_trial_claims_user_unique` ON `billing_trial_claims` (`workos_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_trial_claims_household_unique` ON `billing_trial_claims` (`household_id`);--> statement-breakpoint
CREATE TABLE `household_deletion_requests` (
	`household_id` text PRIMARY KEY NOT NULL,
	`requester_user_id` text NOT NULL,
	`state` text NOT NULL,
	`stripe_cancellation_id` text,
	`stripe_refund_id` text,
	`previewed_amount_minor` integer,
	`refunded_amount_minor` integer,
	`currency` text,
	`requested_at` text NOT NULL,
	`recoverable_until` text,
	`purged_at` text,
	`safe_error_code` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "household_deletion_requests_state_check" CHECK("household_deletion_requests"."state" IN ('requested', 'cancelling', 'refunding', 'recoverable', 'purged', 'failed')),
	CONSTRAINT "household_deletion_requests_preview_amount_nonnegative" CHECK("household_deletion_requests"."previewed_amount_minor" IS NULL OR "household_deletion_requests"."previewed_amount_minor" >= 0),
	CONSTRAINT "household_deletion_requests_refund_amount_nonnegative" CHECK("household_deletion_requests"."refunded_amount_minor" IS NULL OR "household_deletion_requests"."refunded_amount_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `household_deletion_requests_recovery_idx` ON `household_deletion_requests` (`state`,`recoverable_until`);--> statement-breakpoint
CREATE TABLE `mcp_key_households` (
	`key_id` text NOT NULL,
	`household_id` text NOT NULL,
	PRIMARY KEY(`key_id`, `household_id`),
	FOREIGN KEY (`key_id`) REFERENCES `mcp_keys`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mcp_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`label` text NOT NULL,
	`preset` text,
	`grant_mode` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`last_used_at` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mcp_keys_preset_check" CHECK("mcp_keys"."preset" IS NULL OR "mcp_keys"."preset" IN ('read_only_planner', 'meal_planner', 'full_access')),
	CONSTRAINT "mcp_keys_grant_mode_check" CHECK("mcp_keys"."grant_mode" IN ('all', 'selected')),
	CONSTRAINT "mcp_keys_scopes_json_check" CHECK(json_valid("mcp_keys"."scopes"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_keys_hash_unique` ON `mcp_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `mcp_keys_owner_idx` ON `mcp_keys` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`stripe_event_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`received_at` text NOT NULL,
	`processed_at` text,
	`safe_error_code` text,
	CONSTRAINT "stripe_events_state_check" CHECK("stripe_events"."state" IN ('pending', 'processing', 'processed', 'failed')),
	CONSTRAINT "stripe_events_attempts_nonnegative" CHECK("stripe_events"."attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX `stripe_events_processing_idx` ON `stripe_events` (`state`,`received_at`);--> statement-breakpoint
CREATE TABLE `sync_changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mutation_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`origin_device_id` text NOT NULL,
	`audience_kind` text NOT NULL,
	`audience_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`conflict_group` text NOT NULL,
	`operation` text NOT NULL,
	`resulting_revision` integer NOT NULL,
	`occurred_at` text NOT NULL,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`payload` text NOT NULL,
	`tombstone_expires_at` text,
	CONSTRAINT "sync_changes_audience_kind_check" CHECK("sync_changes"."audience_kind" IN ('user', 'household')),
	CONSTRAINT "sync_changes_operation_check" CHECK("sync_changes"."operation" IN ('upsert', 'delete', 'restore', 'purge')),
	CONSTRAINT "sync_changes_revision_positive" CHECK("sync_changes"."resulting_revision" > 0),
	CONSTRAINT "sync_changes_payload_json_check" CHECK(json_valid("sync_changes"."payload"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_changes_mutation_unique` ON `sync_changes` (`mutation_id`);--> statement-breakpoint
CREATE INDEX `sync_changes_audience_seq_idx` ON `sync_changes` (`audience_kind`,`audience_id`,`seq`);--> statement-breakpoint
CREATE INDEX `sync_changes_entity_idx` ON `sync_changes` (`entity_kind`,`entity_id`);--> statement-breakpoint
CREATE TABLE `sync_devices` (
	`device_id` text NOT NULL,
	`workos_user_id` text NOT NULL,
	`display_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_app_version` text NOT NULL,
	`last_protocol_version` integer NOT NULL,
	PRIMARY KEY(`device_id`, `workos_user_id`),
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sync_devices_protocol_version_positive" CHECK("sync_devices"."last_protocol_version" > 0)
);
--> statement-breakpoint
CREATE INDEX `sync_devices_user_seen_idx` ON `sync_devices` (`workos_user_id`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `sync_entity_versions` (
	`audience_kind` text NOT NULL,
	`audience_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`conflict_group` text NOT NULL,
	`revision` integer NOT NULL,
	`last_sequence` integer NOT NULL,
	`winning_occurred_at` text NOT NULL,
	`winning_origin_device_id` text NOT NULL,
	`winning_mutation_id` text NOT NULL,
	PRIMARY KEY(`audience_kind`, `audience_id`, `entity_kind`, `entity_id`, `conflict_group`),
	CONSTRAINT "sync_entity_versions_audience_kind_check" CHECK("sync_entity_versions"."audience_kind" IN ('user', 'household')),
	CONSTRAINT "sync_entity_versions_revision_positive" CHECK("sync_entity_versions"."revision" > 0),
	CONSTRAINT "sync_entity_versions_sequence_positive" CHECK("sync_entity_versions"."last_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE `sync_scope_state` (
	`audience_kind` text NOT NULL,
	`audience_id` text NOT NULL,
	`bootstrap_generation` integer DEFAULT 1 NOT NULL,
	`earliest_retained_sequence` integer DEFAULT 0 NOT NULL,
	`latest_sequence` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`audience_kind`, `audience_id`),
	CONSTRAINT "sync_scope_state_audience_kind_check" CHECK("sync_scope_state"."audience_kind" IN ('user', 'household')),
	CONSTRAINT "sync_scope_state_generation_positive" CHECK("sync_scope_state"."bootstrap_generation" > 0),
	CONSTRAINT "sync_scope_state_floor_nonnegative" CHECK("sync_scope_state"."earliest_retained_sequence" >= 0),
	CONSTRAINT "sync_scope_state_latest_nonnegative" CHECK("sync_scope_state"."latest_sequence" >= 0),
	CONSTRAINT "sync_scope_state_sequence_order_check" CHECK("sync_scope_state"."earliest_retained_sequence" <= "sync_scope_state"."latest_sequence")
);
--> statement-breakpoint
CREATE TABLE `sync_tombstones` (
	`audience_kind` text NOT NULL,
	`audience_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`deletion_sequence` integer NOT NULL,
	`deleted_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`previous_server_ack` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`audience_kind`, `audience_id`, `entity_kind`, `entity_id`),
	CONSTRAINT "sync_tombstones_audience_kind_check" CHECK("sync_tombstones"."audience_kind" IN ('user', 'household')),
	CONSTRAINT "sync_tombstones_sequence_positive" CHECK("sync_tombstones"."deletion_sequence" > 0)
);
--> statement-breakpoint
CREATE INDEX `sync_tombstones_expiry_idx` ON `sync_tombstones` (`expires_at`);--> statement-breakpoint
CREATE TABLE `recipe_appliance_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`appliance` text NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'instruction_heuristic' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recipe_appliance_requirements_appliance_check" CHECK("recipe_appliance_requirements"."appliance" IN ('oven', 'stovetop', 'microwave', 'air_fryer', 'slow_cooker', 'rice_cooker', 'blender', 'food_processor', 'grill')),
	CONSTRAINT "recipe_appliance_requirements_source_check" CHECK("recipe_appliance_requirements"."source" IN ('schema_org', 'instruction_heuristic', 'user')),
	CONSTRAINT "recipe_appliance_requirements_confidence_range" CHECK("recipe_appliance_requirements"."confidence" IS NULL OR ("recipe_appliance_requirements"."confidence" >= 0 AND "recipe_appliance_requirements"."confidence" <= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_appliance_requirements_unique` ON `recipe_appliance_requirements` (`recipe_id`,`appliance`);--> statement-breakpoint
CREATE TABLE `recipe_classifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`schema_org_value` text,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recipe_classifications_kind_check" CHECK("recipe_classifications"."kind" IN ('category', 'cuisine', 'keyword', 'diet')),
	CONSTRAINT "recipe_classifications_confidence_range" CHECK("recipe_classifications"."confidence" IS NULL OR ("recipe_classifications"."confidence" >= 0 AND "recipe_classifications"."confidence" <= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_classifications_unique` ON `recipe_classifications` (`recipe_id`,`kind`,`normalized_value`,`locale`);--> statement-breakpoint
CREATE TABLE `recipe_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
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
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`base_unit_id`,`base_unit_family_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recipe_ingredients_line_nonnegative" CHECK("recipe_ingredients"."line_index" >= 0),
	CONSTRAINT "recipe_ingredients_base_unit_pair_check" CHECK((("recipe_ingredients"."base_unit_id" IS NULL AND "recipe_ingredients"."base_unit_family_id" IS NULL) OR ("recipe_ingredients"."base_unit_id" IS NOT NULL AND "recipe_ingredients"."base_unit_family_id" IS NOT NULL))),
	CONSTRAINT "recipe_ingredients_confidence_range" CHECK("recipe_ingredients"."confidence" IS NULL OR ("recipe_ingredients"."confidence" >= 0 AND "recipe_ingredients"."confidence" <= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_ingredients_recipe_line_unique` ON `recipe_ingredients` (`recipe_id`,`line_index`);--> statement-breakpoint
CREATE INDEX `recipe_ingredients_recipe_idx` ON `recipe_ingredients` (`recipe_id`);--> statement-breakpoint
CREATE INDEX `recipe_ingredients_food_idx` ON `recipe_ingredients` (`base_food_id`);--> statement-breakpoint
CREATE TABLE `recipe_instruction_events` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_instruction_id` text NOT NULL,
	`kind` text NOT NULL,
	`appliance` text,
	`source_text` text NOT NULL,
	`value` real,
	`unit_id` text,
	`base_value` real,
	`base_unit_id` text,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`recipe_instruction_id`) REFERENCES `recipe_instructions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recipe_instruction_events_kind_check" CHECK("recipe_instruction_events"."kind" IN ('temperature', 'duration', 'appliance', 'action')),
	CONSTRAINT "recipe_instruction_events_appliance_check" CHECK("recipe_instruction_events"."appliance" IS NULL OR "recipe_instruction_events"."appliance" IN ('oven', 'stovetop', 'microwave', 'air_fryer', 'slow_cooker', 'rice_cooker', 'blender', 'food_processor', 'grill')),
	CONSTRAINT "recipe_instruction_events_unit_pair_check" CHECK((("recipe_instruction_events"."unit_id" IS NULL AND "recipe_instruction_events"."base_unit_id" IS NULL) OR ("recipe_instruction_events"."unit_id" IS NOT NULL AND "recipe_instruction_events"."base_unit_id" IS NOT NULL))),
	CONSTRAINT "recipe_instruction_events_payload_check" CHECK((
	("recipe_instruction_events"."kind" = 'appliance' AND "recipe_instruction_events"."appliance" IS NOT NULL AND "recipe_instruction_events"."value" IS NULL AND "recipe_instruction_events"."unit_id" IS NULL AND "recipe_instruction_events"."base_value" IS NULL AND "recipe_instruction_events"."base_unit_id" IS NULL)
	OR ("recipe_instruction_events"."kind" IN ('temperature', 'duration') AND "recipe_instruction_events"."appliance" IS NULL AND "recipe_instruction_events"."value" IS NOT NULL AND "recipe_instruction_events"."unit_id" IS NOT NULL AND "recipe_instruction_events"."base_value" IS NOT NULL AND "recipe_instruction_events"."base_unit_id" IS NOT NULL)
	OR ("recipe_instruction_events"."kind" = 'action' AND "recipe_instruction_events"."appliance" IS NULL AND "recipe_instruction_events"."value" IS NULL AND "recipe_instruction_events"."unit_id" IS NULL AND "recipe_instruction_events"."base_value" IS NULL AND "recipe_instruction_events"."base_unit_id" IS NULL)
)),
	CONSTRAINT "recipe_instruction_events_confidence_range" CHECK("recipe_instruction_events"."confidence" IS NULL OR ("recipe_instruction_events"."confidence" >= 0 AND "recipe_instruction_events"."confidence" <= 1))
);
--> statement-breakpoint
CREATE INDEX `recipe_instruction_events_instruction_idx` ON `recipe_instruction_events` (`recipe_instruction_id`);--> statement-breakpoint
CREATE TABLE `recipe_instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`section_name` text,
	`text` text NOT NULL,
	`duration_minutes` integer,
	`confidence` real,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recipe_instructions_step_nonnegative" CHECK("recipe_instructions"."step_index" >= 0),
	CONSTRAINT "recipe_instructions_confidence_range" CHECK("recipe_instructions"."confidence" IS NULL OR ("recipe_instructions"."confidence" >= 0 AND "recipe_instructions"."confidence" <= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_instructions_recipe_step_unique` ON `recipe_instructions` (`recipe_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `recipe_instructions_recipe_idx` ON `recipe_instructions` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_media` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`url` text,
	`content_url` text,
	`embed_url` text,
	`thumbnail_url` text,
	`name` text,
	`caption` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recipe_media_kind_check" CHECK("recipe_media"."kind" IN ('image', 'video')),
	CONSTRAINT "recipe_media_position_nonnegative" CHECK("recipe_media"."position" >= 0),
	CONSTRAINT "recipe_media_payload_check" CHECK("recipe_media"."url" IS NOT NULL OR "recipe_media"."content_url" IS NOT NULL OR "recipe_media"."embed_url" IS NOT NULL OR "recipe_media"."thumbnail_url" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_media_position_unique` ON `recipe_media` (`recipe_id`,`position`);--> statement-breakpoint
CREATE TABLE `recipe_nutrition_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`nutrient` text NOT NULL,
	`schema_org_property` text NOT NULL,
	`original_text` text NOT NULL,
	`amount` real,
	`unit_id` text,
	`base_amount` real,
	`base_unit_id` text,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recipe_nutrition_facts_nutrient_check" CHECK("recipe_nutrition_facts"."nutrient" IN ('calories', 'carbohydrate', 'cholesterol', 'fat', 'fiber', 'protein', 'saturated_fat', 'serving_size', 'sodium', 'sugar', 'trans_fat', 'unsaturated_fat', 'other')),
	CONSTRAINT "recipe_nutrition_facts_unit_pair_check" CHECK((("recipe_nutrition_facts"."unit_id" IS NULL AND "recipe_nutrition_facts"."base_unit_id" IS NULL) OR ("recipe_nutrition_facts"."unit_id" IS NOT NULL AND "recipe_nutrition_facts"."base_unit_id" IS NOT NULL))),
	CONSTRAINT "recipe_nutrition_facts_confidence_range" CHECK("recipe_nutrition_facts"."confidence" IS NULL OR ("recipe_nutrition_facts"."confidence" >= 0 AND "recipe_nutrition_facts"."confidence" <= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_nutrition_facts_unique` ON `recipe_nutrition_facts` (`recipe_id`,`schema_org_property`);--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
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
	`source_imported_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
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
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`saved_from_household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recipes_revision_positive" CHECK("recipes"."revision" > 0),
	CONSTRAINT "recipes_parse_confidence_range" CHECK("recipes"."parse_confidence" IS NULL OR ("recipes"."parse_confidence" >= 0 AND "recipes"."parse_confidence" <= 1)),
	CONSTRAINT "recipes_ingredient_confidence_range" CHECK("recipes"."ingredient_confidence" IS NULL OR ("recipes"."ingredient_confidence" >= 0 AND "recipes"."ingredient_confidence" <= 1)),
	CONSTRAINT "recipes_instruction_confidence_range" CHECK("recipes"."instruction_confidence" IS NULL OR ("recipes"."instruction_confidence" >= 0 AND "recipes"."instruction_confidence" <= 1)),
	CONSTRAINT "recipes_nutrition_confidence_range" CHECK("recipes"."nutrition_confidence" IS NULL OR ("recipes"."nutrition_confidence" >= 0 AND "recipes"."nutrition_confidence" <= 1))
);
--> statement-breakpoint
CREATE INDEX `recipes_owner_visible_idx` ON `recipes` (`owner_user_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `recipes_saved_from_household_idx` ON `recipes` (`saved_from_household_id`);--> statement-breakpoint
CREATE INDEX `recipes_source_url_idx` ON `recipes` (`source_url`);--> statement-breakpoint
CREATE INDEX `recipes_source_html_hash_idx` ON `recipes` (`source_html_hash`);--> statement-breakpoint
CREATE INDEX `recipes_updated_idx` ON `recipes` (`updated_at`);--> statement-breakpoint
CREATE TABLE `food_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`food_id` text NOT NULL,
	`alias` text NOT NULL,
	`locale` text NOT NULL,
	`source_domain` text,
	`default_for_locale` integer DEFAULT false NOT NULL,
	`default_measure_unit_id` text,
	`default_measure_base_unit_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_measure_unit_id`,`default_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_aliases_domain_not_default_check" CHECK("food_aliases"."source_domain" IS NULL OR "food_aliases"."default_for_locale" = 0),
	CONSTRAINT "food_aliases_default_measure_pair_check" CHECK((("food_aliases"."default_measure_unit_id" IS NULL AND "food_aliases"."default_measure_base_unit_id" IS NULL) OR ("food_aliases"."default_measure_unit_id" IS NOT NULL AND "food_aliases"."default_measure_base_unit_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_aliases_default_per_food_locale` ON `food_aliases` (`food_id`,`locale`) WHERE "food_aliases"."default_for_locale" = 1 AND "food_aliases"."source_domain" IS NULL;--> statement-breakpoint
CREATE INDEX `food_aliases_lookup_idx` ON `food_aliases` (`source_domain`,`locale`,`alias`);--> statement-breakpoint
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
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_measure_unit_id`,`default_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_household_aliases_adoption_check" CHECK("food_household_aliases"."adoption_status" IN ('pending_review', 'accepted', 'rejected')),
	CONSTRAINT "food_household_aliases_default_measure_pair_check" CHECK((("food_household_aliases"."default_measure_unit_id" IS NULL AND "food_household_aliases"."default_measure_base_unit_id" IS NULL) OR ("food_household_aliases"."default_measure_unit_id" IS NOT NULL AND "food_household_aliases"."default_measure_base_unit_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_household_aliases_identity_unique` ON `food_household_aliases` (`household_id`,`food_id`,`locale`,`alias`);--> statement-breakpoint
CREATE INDEX `food_household_aliases_lookup_idx` ON `food_household_aliases` (`household_id`,`locale`,`alias`);--> statement-breakpoint
CREATE TABLE `food_household_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`canonical_label` text NOT NULL,
	`default_measure_unit_id` text,
	`default_measure_base_unit_id` text,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_measure_unit_id`,`default_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_household_entries_adoption_check" CHECK("food_household_entries"."adoption_status" IN ('pending_review', 'accepted', 'rejected')),
	CONSTRAINT "food_household_entries_default_measure_pair_check" CHECK((("food_household_entries"."default_measure_unit_id" IS NULL AND "food_household_entries"."default_measure_base_unit_id" IS NULL) OR ("food_household_entries"."default_measure_unit_id" IS NOT NULL AND "food_household_entries"."default_measure_base_unit_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_household_entries_label_unique` ON `food_household_entries` (`household_id`,`canonical_label`);--> statement-breakpoint
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
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_measure_unit_id`,`default_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_user_aliases_adoption_check" CHECK("food_user_aliases"."adoption_status" IN ('pending_review', 'accepted', 'rejected')),
	CONSTRAINT "food_user_aliases_default_measure_pair_check" CHECK((("food_user_aliases"."default_measure_unit_id" IS NULL AND "food_user_aliases"."default_measure_base_unit_id" IS NULL) OR ("food_user_aliases"."default_measure_unit_id" IS NOT NULL AND "food_user_aliases"."default_measure_base_unit_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_user_aliases_identity_unique` ON `food_user_aliases` (`workos_user_id`,`food_id`,`locale`,`alias`);--> statement-breakpoint
CREATE INDEX `food_user_aliases_lookup_idx` ON `food_user_aliases` (`workos_user_id`,`locale`,`alias`);--> statement-breakpoint
CREATE TABLE `food_user_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`canonical_label` text NOT NULL,
	`default_measure_unit_id` text,
	`default_measure_base_unit_id` text,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_measure_unit_id`,`default_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "food_user_entries_adoption_check" CHECK("food_user_entries"."adoption_status" IN ('pending_review', 'accepted', 'rejected')),
	CONSTRAINT "food_user_entries_default_measure_pair_check" CHECK((("food_user_entries"."default_measure_unit_id" IS NULL AND "food_user_entries"."default_measure_base_unit_id" IS NULL) OR ("food_user_entries"."default_measure_unit_id" IS NOT NULL AND "food_user_entries"."default_measure_base_unit_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_user_entries_label_unique` ON `food_user_entries` (`workos_user_id`,`canonical_label`);--> statement-breakpoint
CREATE TABLE `foods` (
	`id` text PRIMARY KEY NOT NULL,
	`default_measure_unit_id` text NOT NULL,
	`default_measure_base_unit_id` text NOT NULL,
	FOREIGN KEY (`default_measure_unit_id`,`default_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `household_food_display_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`preferred_food_alias_scope` text,
	`food_id` text NOT NULL,
	`locale` text NOT NULL,
	`preferred_food_alias_id` text,
	`preferred_measure_unit_id` text,
	`preferred_measure_base_unit_id` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`preferred_measure_unit_id`,`preferred_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "household_food_display_preferences_alias_pair_check" CHECK((("household_food_display_overrides"."preferred_food_alias_scope" IS NULL AND "household_food_display_overrides"."preferred_food_alias_id" IS NULL) OR ("household_food_display_overrides"."preferred_food_alias_scope" IS NOT NULL AND "household_food_display_overrides"."preferred_food_alias_id" IS NOT NULL))),
	CONSTRAINT "household_food_display_preferences_measure_pair_check" CHECK((("household_food_display_overrides"."preferred_measure_unit_id" IS NULL AND "household_food_display_overrides"."preferred_measure_base_unit_id" IS NULL) OR ("household_food_display_overrides"."preferred_measure_unit_id" IS NOT NULL AND "household_food_display_overrides"."preferred_measure_base_unit_id" IS NOT NULL))),
	CONSTRAINT "household_food_display_preferences_alias_scope_check" CHECK("household_food_display_overrides"."preferred_food_alias_scope" IS NULL OR "household_food_display_overrides"."preferred_food_alias_scope" IN ('global', 'household'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_food_display_preferences_unique` ON `household_food_display_overrides` (`household_id`,`food_id`,`locale`);--> statement-breakpoint
CREATE TABLE `household_unit_display_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`preferred_unit_alias_scope` text,
	`base_unit_id` text NOT NULL,
	`locale` text NOT NULL,
	`preferred_unit_id` text NOT NULL,
	`preferred_unit_alias_id` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preferred_unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "household_unit_display_preferences_alias_pair_check" CHECK((("household_unit_display_overrides"."preferred_unit_alias_scope" IS NULL AND "household_unit_display_overrides"."preferred_unit_alias_id" IS NULL) OR ("household_unit_display_overrides"."preferred_unit_alias_scope" IS NOT NULL AND "household_unit_display_overrides"."preferred_unit_alias_id" IS NOT NULL))),
	CONSTRAINT "household_unit_display_preferences_alias_scope_check" CHECK("household_unit_display_overrides"."preferred_unit_alias_scope" IS NULL OR "household_unit_display_overrides"."preferred_unit_alias_scope" IN ('global', 'household'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_unit_display_preferences_unique` ON `household_unit_display_overrides` (`household_id`,`base_unit_id`,`locale`);--> statement-breakpoint
CREATE TABLE `unit_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`base_unit_id` text NOT NULL,
	`alias` text NOT NULL,
	`plural_alias` text,
	`locale` text NOT NULL,
	`source_domain` text,
	`default_for_locale` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "unit_aliases_domain_not_default_check" CHECK("unit_aliases"."source_domain" IS NULL OR "unit_aliases"."default_for_locale" = 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_aliases_default_per_base_locale` ON `unit_aliases` (`base_unit_id`,`locale`) WHERE "unit_aliases"."default_for_locale" = 1 AND "unit_aliases"."source_domain" IS NULL;--> statement-breakpoint
CREATE INDEX `unit_aliases_unit_idx` ON `unit_aliases` (`unit_id`);--> statement-breakpoint
CREATE INDEX `unit_aliases_lookup_idx` ON `unit_aliases` (`source_domain`,`locale`,`alias`);--> statement-breakpoint
CREATE TABLE `unit_household_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`base_unit_id` text NOT NULL,
	`alias` text NOT NULL,
	`plural_alias` text,
	`locale` text NOT NULL,
	`source_domain` text,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "unit_household_aliases_adoption_check" CHECK("unit_household_aliases"."adoption_status" IN ('pending_review', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_household_aliases_identity_unique` ON `unit_household_aliases` (`household_id`,`base_unit_id`,`locale`,`alias`);--> statement-breakpoint
CREATE INDEX `unit_household_aliases_lookup_idx` ON `unit_household_aliases` (`household_id`,`locale`,`alias`);--> statement-breakpoint
CREATE TABLE `unit_household_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`canonical_label` text NOT NULL,
	`base_unit_id` text NOT NULL,
	`to_base_factor` real DEFAULT 1 NOT NULL,
	`to_base_offset` real DEFAULT 0 NOT NULL,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "unit_household_entries_adoption_check" CHECK("unit_household_entries"."adoption_status" IN ('pending_review', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_household_entries_label_unique` ON `unit_household_entries` (`household_id`,`canonical_label`);--> statement-breakpoint
CREATE INDEX `unit_household_entries_base_idx` ON `unit_household_entries` (`base_unit_id`);--> statement-breakpoint
CREATE TABLE `unit_user_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`base_unit_id` text NOT NULL,
	`alias` text NOT NULL,
	`plural_alias` text,
	`locale` text NOT NULL,
	`source_domain` text,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "unit_user_aliases_adoption_check" CHECK("unit_user_aliases"."adoption_status" IN ('pending_review', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_user_aliases_identity_unique` ON `unit_user_aliases` (`workos_user_id`,`base_unit_id`,`locale`,`alias`);--> statement-breakpoint
CREATE INDEX `unit_user_aliases_lookup_idx` ON `unit_user_aliases` (`workos_user_id`,`locale`,`alias`);--> statement-breakpoint
CREATE TABLE `unit_user_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`canonical_label` text NOT NULL,
	`base_unit_id` text NOT NULL,
	`to_base_factor` real DEFAULT 1 NOT NULL,
	`to_base_offset` real DEFAULT 0 NOT NULL,
	`adoption_status` text DEFAULT 'pending_review' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "unit_user_entries_adoption_check" CHECK("unit_user_entries"."adoption_status" IN ('pending_review', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_user_entries_label_unique` ON `unit_user_entries` (`workos_user_id`,`canonical_label`);--> statement-breakpoint
CREATE INDEX `unit_user_entries_base_idx` ON `unit_user_entries` (`base_unit_id`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`base_unit_id` text NOT NULL,
	`to_base_factor` real DEFAULT 1 NOT NULL,
	`to_base_offset` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_id_base_unit_unique` ON `units` (`id`,`base_unit_id`);--> statement-breakpoint
CREATE TABLE `user_food_display_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`preferred_food_alias_scope` text,
	`food_id` text NOT NULL,
	`locale` text NOT NULL,
	`preferred_food_alias_id` text,
	`preferred_measure_unit_id` text,
	`preferred_measure_base_unit_id` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`preferred_measure_unit_id`,`preferred_measure_base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_food_display_preferences_alias_pair_check" CHECK((("user_food_display_overrides"."preferred_food_alias_scope" IS NULL AND "user_food_display_overrides"."preferred_food_alias_id" IS NULL) OR ("user_food_display_overrides"."preferred_food_alias_scope" IS NOT NULL AND "user_food_display_overrides"."preferred_food_alias_id" IS NOT NULL))),
	CONSTRAINT "user_food_display_preferences_measure_pair_check" CHECK((("user_food_display_overrides"."preferred_measure_unit_id" IS NULL AND "user_food_display_overrides"."preferred_measure_base_unit_id" IS NULL) OR ("user_food_display_overrides"."preferred_measure_unit_id" IS NOT NULL AND "user_food_display_overrides"."preferred_measure_base_unit_id" IS NOT NULL))),
	CONSTRAINT "user_food_display_preferences_alias_scope_check" CHECK("user_food_display_overrides"."preferred_food_alias_scope" IS NULL OR "user_food_display_overrides"."preferred_food_alias_scope" IN ('global', 'household', 'user'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_food_display_preferences_unique` ON `user_food_display_overrides` (`workos_user_id`,`food_id`,`locale`);--> statement-breakpoint
CREATE TABLE `user_food_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`food_id` text NOT NULL,
	`preference` text NOT NULL,
	`reason` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_food_preferences_preference_check" CHECK("user_food_preferences"."preference" IN ('favourite', 'like', 'dislike', 'disallowed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_food_preferences_user_food_unique` ON `user_food_preferences` (`workos_user_id`,`food_id`);--> statement-breakpoint
CREATE INDEX `user_food_preferences_user_idx` ON `user_food_preferences` (`workos_user_id`);--> statement-breakpoint
CREATE TABLE `user_unit_display_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`preferred_unit_alias_scope` text,
	`base_unit_id` text NOT NULL,
	`locale` text NOT NULL,
	`preferred_unit_id` text NOT NULL,
	`preferred_unit_alias_id` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preferred_unit_id`,`base_unit_id`) REFERENCES `units`(`id`,`base_unit_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_unit_display_preferences_alias_pair_check" CHECK((("user_unit_display_overrides"."preferred_unit_alias_scope" IS NULL AND "user_unit_display_overrides"."preferred_unit_alias_id" IS NULL) OR ("user_unit_display_overrides"."preferred_unit_alias_scope" IS NOT NULL AND "user_unit_display_overrides"."preferred_unit_alias_id" IS NOT NULL))),
	CONSTRAINT "user_unit_display_preferences_alias_scope_check" CHECK("user_unit_display_overrides"."preferred_unit_alias_scope" IS NULL OR "user_unit_display_overrides"."preferred_unit_alias_scope" IN ('global', 'household', 'user'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_unit_display_preferences_unique` ON `user_unit_display_overrides` (`workos_user_id`,`base_unit_id`,`locale`);