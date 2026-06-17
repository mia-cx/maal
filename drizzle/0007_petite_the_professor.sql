UPDATE `household_food_display_overrides`
SET `preferred_food_alias_id` = (
	SELECT MIN(`canonical`.`id`)
	FROM `food_household_aliases` AS `duplicate`
	JOIN `food_household_aliases` AS `canonical`
		ON `canonical`.`household_id` = `duplicate`.`household_id`
		AND `canonical`.`food_id` = `duplicate`.`food_id`
		AND `canonical`.`locale` = `duplicate`.`locale`
		AND `canonical`.`alias` = `duplicate`.`alias`
	WHERE `duplicate`.`id` = `household_food_display_overrides`.`preferred_food_alias_id`
)
WHERE `preferred_food_alias_scope` = 'household'
	AND `preferred_food_alias_id` IN (
		SELECT `alias`.`id`
		FROM `food_household_aliases` AS `alias`
		WHERE `alias`.`id` != (
			SELECT MIN(`canonical`.`id`)
			FROM `food_household_aliases` AS `canonical`
			WHERE `canonical`.`household_id` = `alias`.`household_id`
				AND `canonical`.`food_id` = `alias`.`food_id`
				AND `canonical`.`locale` = `alias`.`locale`
				AND `canonical`.`alias` = `alias`.`alias`
		)
	);--> statement-breakpoint
UPDATE `household_unit_display_overrides`
SET `preferred_unit_alias_id` = (
	SELECT MIN(`canonical`.`id`)
	FROM `unit_household_aliases` AS `duplicate`
	JOIN `unit_household_aliases` AS `canonical`
		ON `canonical`.`household_id` = `duplicate`.`household_id`
		AND `canonical`.`base_unit_id` = `duplicate`.`base_unit_id`
		AND `canonical`.`locale` = `duplicate`.`locale`
		AND `canonical`.`alias` = `duplicate`.`alias`
	WHERE `duplicate`.`id` = `household_unit_display_overrides`.`preferred_unit_alias_id`
)
WHERE `preferred_unit_alias_scope` = 'household'
	AND `preferred_unit_alias_id` IN (
		SELECT `alias`.`id`
		FROM `unit_household_aliases` AS `alias`
		WHERE `alias`.`id` != (
			SELECT MIN(`canonical`.`id`)
			FROM `unit_household_aliases` AS `canonical`
			WHERE `canonical`.`household_id` = `alias`.`household_id`
				AND `canonical`.`base_unit_id` = `alias`.`base_unit_id`
				AND `canonical`.`locale` = `alias`.`locale`
				AND `canonical`.`alias` = `alias`.`alias`
		)
	);--> statement-breakpoint
DELETE FROM `food_household_aliases`
WHERE `id` NOT IN (
	SELECT MIN(`id`)
	FROM `food_household_aliases`
	GROUP BY `household_id`, `food_id`, `locale`, `alias`
);--> statement-breakpoint
DELETE FROM `unit_household_aliases`
WHERE `id` NOT IN (
	SELECT MIN(`id`)
	FROM `unit_household_aliases`
	GROUP BY `household_id`, `base_unit_id`, `locale`, `alias`
);--> statement-breakpoint
CREATE UNIQUE INDEX `food_household_aliases_identity_unique` ON `food_household_aliases` (`household_id`,`food_id`,`locale`,`alias`);--> statement-breakpoint
CREATE UNIQUE INDEX `unit_household_aliases_identity_unique` ON `unit_household_aliases` (`household_id`,`base_unit_id`,`locale`,`alias`);
