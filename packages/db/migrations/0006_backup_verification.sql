CREATE TABLE `backup_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`at` text NOT NULL,
	`ok` integer NOT NULL,
	`summary` text NOT NULL,
	CONSTRAINT "backup_verification_kind" CHECK("backup_verification"."kind" IN ('check', 'drill')),
	CONSTRAINT "backup_verification_ok" CHECK("backup_verification"."ok" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE INDEX `backup_verification_kind_at_idx` ON `backup_verification` (`kind`,`at`);