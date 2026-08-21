PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_household_deletion_requests` (
	`household_id` text PRIMARY KEY NOT NULL,
	`requester_user_id` text NOT NULL,
	`state` text NOT NULL,
	`stripe_cancellation_id` text,
	`stripe_charge_id` text,
	`stripe_refund_id` text,
	`previewed_amount_minor` integer,
	`refunded_amount_minor` integer,
	`currency` text,
	`requested_at` text NOT NULL,
	`recoverable_until` text,
	`purged_at` text,
	`safe_error_code` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "household_deletion_requests_state_check" CHECK("__new_household_deletion_requests"."state" IN ('requested', 'cancelling', 'refunding', 'recoverable', 'recovered', 'purged', 'failed')),
	CONSTRAINT "household_deletion_requests_preview_amount_nonnegative" CHECK("__new_household_deletion_requests"."previewed_amount_minor" IS NULL OR "__new_household_deletion_requests"."previewed_amount_minor" >= 0),
	CONSTRAINT "household_deletion_requests_refund_amount_nonnegative" CHECK("__new_household_deletion_requests"."refunded_amount_minor" IS NULL OR "__new_household_deletion_requests"."refunded_amount_minor" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_household_deletion_requests`("household_id", "requester_user_id", "state", "stripe_cancellation_id", "stripe_refund_id", "previewed_amount_minor", "refunded_amount_minor", "currency", "requested_at", "recoverable_until", "purged_at", "safe_error_code", "updated_at") SELECT "household_id", "requester_user_id", "state", "stripe_cancellation_id", "stripe_refund_id", "previewed_amount_minor", "refunded_amount_minor", "currency", "requested_at", "recoverable_until", "purged_at", "safe_error_code", "updated_at" FROM `household_deletion_requests`;--> statement-breakpoint
DROP TABLE `household_deletion_requests`;--> statement-breakpoint
ALTER TABLE `__new_household_deletion_requests` RENAME TO `household_deletion_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `household_deletion_requests_recovery_idx` ON `household_deletion_requests` (`state`,`recoverable_until`);--> statement-breakpoint
ALTER TABLE `billing_subscriptions` ADD `last_successful_payment_at` text;--> statement-breakpoint
ALTER TABLE `billing_subscriptions` ADD `last_stripe_event_created_at` text;--> statement-breakpoint
ALTER TABLE `billing_subscriptions` ADD `last_stripe_event_id` text;
