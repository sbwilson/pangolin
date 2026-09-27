CREATE TABLE `backup_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`taken_at` text NOT NULL,
	`schema_version` integer NOT NULL,
	`table_count` integer NOT NULL,
	`row_count` integer NOT NULL,
	`manifest_sha256` text NOT NULL,
	`push_job_id` text NOT NULL,
	`restic_snapshot_id` text,
	`pushed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "backup_snapshot_pushed" CHECK(("backup_snapshot"."restic_snapshot_id" IS NULL) = ("backup_snapshot"."pushed_at" IS NULL)),
	CONSTRAINT "backup_snapshot_counts" CHECK("backup_snapshot"."table_count" >= 0 AND "backup_snapshot"."row_count" >= 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX `backup_snapshot_pushed_idx` ON `backup_snapshot` (`pushed_at`);