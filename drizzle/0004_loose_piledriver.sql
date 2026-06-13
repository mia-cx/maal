PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_meal_check_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`workos_user_id` text NOT NULL,
	`household_meal_id` text,
	`cook_time` integer,
	`verdict` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workos_user_id`) REFERENCES `users`(`workos_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_meal_id`) REFERENCES `household_meals`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "meal_check_ins_cook_time_positive_check" CHECK("__new_meal_check_ins"."cook_time" IS NULL OR "__new_meal_check_ins"."cook_time" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_meal_check_ins`("id", "workos_user_id", "household_meal_id", "cook_time", "verdict", "reason", "created_at", "updated_at") SELECT "id", "workos_user_id", "household_meal_id", "cook_time", "verdict", "reason", "created_at", "updated_at" FROM `meal_check_ins`;--> statement-breakpoint
DROP TABLE `meal_check_ins`;--> statement-breakpoint
ALTER TABLE `__new_meal_check_ins` RENAME TO `meal_check_ins`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `meal_check_ins_meal_user_unique` ON `meal_check_ins` (`household_meal_id`,`workos_user_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_household_meal_id_idx` ON `meal_check_ins` (`household_meal_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_workos_user_id_idx` ON `meal_check_ins` (`workos_user_id`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_user_verdict_idx` ON `meal_check_ins` (`workos_user_id`,`verdict`);--> statement-breakpoint
CREATE INDEX `meal_check_ins_verdict_idx` ON `meal_check_ins` (`verdict`);