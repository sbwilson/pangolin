CREATE TABLE `rule` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`priority` integer NOT NULL,
	`conditions` text NOT NULL,
	`actions` text NOT NULL,
	`origin` text NOT NULL,
	`scope_person_id` text,
	`origin_account_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`scope_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rule_origin" CHECK("rule"."origin" IN ('user', 'correction', 'llm_suggested'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `rule_name_shared_idx` ON `rule` (`name`) WHERE scope_person_id IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `rule_name_scoped_idx` ON `rule` (`scope_person_id`, `name`) WHERE scope_person_id IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `rule_priority_idx` ON `rule` (`priority`);
