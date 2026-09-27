CREATE TABLE `job` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`lane` text NOT NULL,
	`payload` text NOT NULL,
	`dedupe_key` text,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`max_attempts` integer NOT NULL,
	`run_at` text NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`finished_at` text,
	CONSTRAINT "job_lane" CHECK("job"."lane" IN ('llm', 'net', 'local')),
	CONSTRAINT "job_status" CHECK("job"."status" IN ('pending', 'running', 'done', 'dead')),
	CONSTRAINT "job_payload_json" CHECK(json_valid("job"."payload")),
	CONSTRAINT "job_attempts" CHECK("job"."attempts" >= 0 AND "job"."max_attempts" >= 1),
	CONSTRAINT "job_lease" CHECK("job"."status" <> 'running' OR ("job"."lease_owner" IS NOT NULL AND "job"."lease_expires_at" IS NOT NULL)),
	CONSTRAINT "job_finished" CHECK(("job"."status" IN ('done', 'dead')) = ("job"."finished_at" IS NOT NULL))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `job_dedupe_key_live_idx` ON `job` (`dedupe_key`) WHERE status IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX `job_claim_idx` ON `job` (`lane`,`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `job_finished_idx` ON `job` (`status`,`finished_at`);--> statement-breakpoint
CREATE TABLE `review_item` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`account_id` text,
	`person_id` text,
	`entity_ref` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolution` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_item_resolution" CHECK(("review_item"."resolved_at" IS NULL) = ("review_item"."resolution" IS NULL)),
	CONSTRAINT "review_item_scope" CHECK("review_item"."account_id" IS NULL OR "review_item"."person_id" IS NULL)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `review_item_dedupe_key_open_idx` ON `review_item` (`dedupe_key`) WHERE resolved_at IS NULL;
