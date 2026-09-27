CREATE TABLE `re_enrolment_link` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`issued_by` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "re_enrolment_link_issued_by" CHECK("re_enrolment_link"."issued_by" = 'cli:reset-user' OR "re_enrolment_link"."issued_by" LIKE 'person:%')
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `re_enrolment_link_token_hash_unique` ON `re_enrolment_link` (`token_hash`);--> statement-breakpoint
CREATE INDEX `re_enrolment_link_person_idx` ON `re_enrolment_link` (`person_id`);--> statement-breakpoint
CREATE TABLE `recovery_code` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `recovery_code_person_hash_idx` ON `recovery_code` (`person_id`,`code_hash`);