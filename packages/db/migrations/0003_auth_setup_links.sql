CREATE TABLE `auth_account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` text,
	`refresh_token_expires_at` text,
	`scope` text,
	`password` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `auth_account_user_id_idx` ON `auth_account` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`aaguid` text,
	`created_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `auth_passkey_user_id_idx` ON `auth_passkey` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_passkey_credential_id_idx` ON `auth_passkey` (`credential_id`);--> statement-breakpoint
CREATE TABLE `auth_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_session_token_unique` ON `auth_session` (`token`);--> statement-breakpoint
CREATE INDEX `auth_session_user_id_idx` ON `auth_session` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`verified` integer,
	`failed_verification_count` integer,
	`locked_until` text,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `auth_two_factor_secret_idx` ON `auth_two_factor` (`secret`);--> statement-breakpoint
CREATE INDEX `auth_two_factor_user_id_idx` ON `auth_two_factor` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`two_factor_enabled` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_user_email_unique` ON `auth_user` (`email`);--> statement-breakpoint
CREATE TABLE `auth_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX `auth_verification_identifier_idx` ON `auth_verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `login_attempt` (
	`id` integer PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`at` text NOT NULL,
	`ok` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX `login_attempt_email_at_idx` ON `login_attempt` (`email`,`at`);--> statement-breakpoint
CREATE TABLE `setup_link` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`issued_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	CONSTRAINT "setup_link_issued_by" CHECK("setup_link"."issued_by" = 'cli' OR "setup_link"."issued_by" LIKE 'person:%')
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `setup_link_token_hash_unique` ON `setup_link` (`token_hash`);