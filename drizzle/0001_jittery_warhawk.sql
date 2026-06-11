ALTER TABLE `household_profiles` ADD `week_starts_on` text DEFAULT 'monday' NOT NULL;--> statement-breakpoint
ALTER TABLE `household_profiles` ADD `measurement_system` text DEFAULT 'metric' NOT NULL;--> statement-breakpoint
ALTER TABLE `household_profiles` DROP COLUMN `default_calendar_duration_days`;--> statement-breakpoint
ALTER TABLE `household_profiles` DROP COLUMN `default_calendar_anchor`;