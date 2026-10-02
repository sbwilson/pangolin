CREATE TABLE `recovery_bundle` (
	`id` integer PRIMARY KEY NOT NULL,
	`bundle_id` text NOT NULL,
	`confirmed_at` text NOT NULL,
	CONSTRAINT "recovery_bundle_singleton" CHECK("recovery_bundle"."id" = 1)
) STRICT;