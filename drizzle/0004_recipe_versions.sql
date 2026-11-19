CREATE TABLE `recipe_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`effective_at` text NOT NULL,
	`recipe` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_versions_recipe_idx` ON `recipe_versions` (`recipe_id`,`effective_at`);--> statement-breakpoint
CREATE INDEX `recipe_versions_owner_idx` ON `recipe_versions` (`owner_user_id`);--> statement-breakpoint
ALTER TABLE `meal_check_ins` ADD `recipe_version_id` text;--> statement-breakpoint
ALTER TABLE `meals` ADD `followed_recipe_id` text;--> statement-breakpoint
CREATE INDEX `meals_followed_recipe_idx` ON `meals` (`followed_recipe_id`);