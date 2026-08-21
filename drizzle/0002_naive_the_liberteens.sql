CREATE TABLE `sync_mutation_receipts` (
	`mutation_id` text PRIMARY KEY NOT NULL,
	`audience_kind` text NOT NULL,
	`audience_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`status` text NOT NULL,
	`sequence` integer,
	`resulting_revision` integer,
	`error_code` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`retain_until` text NOT NULL,
	CONSTRAINT "sync_mutation_receipts_audience_kind_check" CHECK("sync_mutation_receipts"."audience_kind" IN ('user', 'household')),
	CONSTRAINT "sync_mutation_receipts_status_check" CHECK("sync_mutation_receipts"."status" IN ('accepted', 'rejected')),
	CONSTRAINT "sync_mutation_receipts_result_check" CHECK(("sync_mutation_receipts"."status" = 'accepted' AND "sync_mutation_receipts"."sequence" > 0 AND "sync_mutation_receipts"."resulting_revision" > 0 AND "sync_mutation_receipts"."error_code" IS NULL)
			 OR ("sync_mutation_receipts"."status" = 'rejected' AND "sync_mutation_receipts"."sequence" IS NULL AND "sync_mutation_receipts"."resulting_revision" IS NULL AND "sync_mutation_receipts"."error_code" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `sync_mutation_receipts_audience_idx` ON `sync_mutation_receipts` (`audience_kind`,`audience_id`);--> statement-breakpoint
CREATE INDEX `sync_mutation_receipts_retention_idx` ON `sync_mutation_receipts` (`retain_until`);