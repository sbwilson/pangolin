CREATE TABLE `__new_backup_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`taken_at` text NOT NULL,
	`schema_version` integer NOT NULL,
	`push_job_id` text NOT NULL,
	`restic_snapshot_id` text,
	`pushed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "backup_snapshot_pushed" CHECK(("__new_backup_snapshot"."restic_snapshot_id" IS NULL) = ("__new_backup_snapshot"."pushed_at" IS NULL))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_backup_snapshot`("id", "taken_at", "schema_version", "push_job_id", "restic_snapshot_id", "pushed_at", "created_at", "updated_at") SELECT "id", "taken_at", "schema_version", "push_job_id", "restic_snapshot_id", "pushed_at", "created_at", "updated_at" FROM `backup_snapshot`;--> statement-breakpoint
DROP TABLE `backup_snapshot`;--> statement-breakpoint
ALTER TABLE `__new_backup_snapshot` RENAME TO `backup_snapshot`;--> statement-breakpoint
CREATE INDEX `backup_snapshot_pushed_idx` ON `backup_snapshot` (`pushed_at`);--> statement-breakpoint
UPDATE `audit_log` SET
	`before` = json_remove(`before`, '$.tableCount', '$.rowCount', '$.manifestSha256'),
	`after` = json_remove(`after`, '$.tableCount', '$.rowCount', '$.manifestSha256')
WHERE `entity` = 'backup_snapshot';--> statement-breakpoint
UPDATE `backup_verification` SET `summary` = substr(`summary`, 1, instr(`summary`, ' and verified ') - 1) || ' and verified the restore'
WHERE `kind` = 'drill' AND `ok` = 1 AND instr(`summary`, ' and verified ') > 0;--> statement-breakpoint
UPDATE `audit_log` SET `after` = json_set(`after`, '$.summary', substr(json_extract(`after`, '$.summary'), 1, instr(json_extract(`after`, '$.summary'), ' and verified ') - 1) || ' and verified the restore')
WHERE `entity` = 'backup_verification' AND json_extract(`after`, '$.kind') = 'drill' AND json_extract(`after`, '$.ok') = 1 AND instr(json_extract(`after`, '$.summary'), ' and verified ') > 0;
