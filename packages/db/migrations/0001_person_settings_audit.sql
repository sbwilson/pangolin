CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`account_id` text,
	`person_id` text,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	CONSTRAINT "audit_log_before_json" CHECK("audit_log"."before" IS NULL OR json_valid("audit_log"."before")),
	CONSTRAINT "audit_log_after_json" CHECK("audit_log"."after" IS NULL OR json_valid("audit_log"."after"))
) STRICT;
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE TABLE `household_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`base_currency` text NOT NULL,
	`fy_start` text NOT NULL,
	`timezone` text NOT NULL,
	`shared_attribution` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "household_settings_singleton" CHECK("household_settings"."id" = 1),
	CONSTRAINT "household_settings_shared_attribution" CHECK("household_settings"."shared_attribution" IN ('contribution', 'even'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `person` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`display_name` text NOT NULL,
	`colour` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `person_user_id_unique` ON `person` (`user_id`);--> statement-breakpoint
-- Hand-added: the single household_settings row with the v1 defaults.
INSERT INTO `household_settings` (`id`, `base_currency`, `fy_start`, `timezone`, `shared_attribution`, `updated_at`)
VALUES (1, 'AUD', '07-01', 'Australia/Sydney', 'contribution', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
