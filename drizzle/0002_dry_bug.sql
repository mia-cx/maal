ALTER TABLE `stripe_events` ADD `stripe_subscription_id` text;--> statement-breakpoint
ALTER TABLE `stripe_events` ADD `stripe_created_at` text;--> statement-breakpoint
ALTER TABLE `stripe_events` ADD `event_status` text;--> statement-breakpoint
CREATE INDEX `stripe_events_subscription_created_idx` ON `stripe_events` (`stripe_subscription_id`,`stripe_created_at`);
