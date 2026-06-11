ALTER TABLE `household_profiles` ADD `preferred_mass_unit` text DEFAULT 'g' NOT NULL;--> statement-breakpoint
ALTER TABLE `household_profiles` ADD `preferred_volume_unit` text DEFAULT 'ml' NOT NULL;--> statement-breakpoint
ALTER TABLE `household_profiles` ADD `ingredient_unit_overrides_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `household_profiles` DROP COLUMN `measurement_system`;