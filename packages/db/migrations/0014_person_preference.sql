CREATE TABLE `person_preference` (
	`person_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'clay-linen' NOT NULL,
	`mode` text DEFAULT 'system' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "person_preference_theme" CHECK("person_preference"."theme" IN ('clay-linen', 'harbour-morning', 'fern-gully', 'galah-party', 'gelato-bar', 'black-opal')),
	CONSTRAINT "person_preference_mode" CHECK("person_preference"."mode" IN ('light', 'dark', 'system'))
) STRICT;
