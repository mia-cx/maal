ALTER TABLE `meal_check_ins` ADD `household_id` text REFERENCES households(household_id);--> statement-breakpoint
UPDATE `meal_check_ins`
SET `household_id` = (
	SELECT `household_id` FROM `meals` WHERE `meals`.`id` = `meal_check_ins`.`meal_id`
)
WHERE `household_id` IS NULL AND `meal_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `meal_check_ins_household_idx` ON `meal_check_ins` (`household_id`);
