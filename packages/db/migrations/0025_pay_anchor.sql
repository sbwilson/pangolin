CREATE TABLE `pay_anchor` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL UNIQUE,
	`account_id` text NOT NULL,
	`cadence` text NOT NULL,
	`day_of_month` integer,
	`anchor_date` text,
	`alignment` text DEFAULT 'calendar' NOT NULL,
	`expected_net_cents` integer,
	`expected_gross_cents` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `pay_anchor_cadence` CHECK(`pay_anchor`.`cadence` IN ('fortnightly', 'monthly')),
	CONSTRAINT `pay_anchor_alignment` CHECK(`pay_anchor`.`alignment` IN ('calendar', 'deposit')),
	CONSTRAINT `pay_anchor_cadence_fields` CHECK((`pay_anchor`.`cadence` = 'fortnightly' AND `pay_anchor`.`anchor_date` IS NOT NULL) OR (`pay_anchor`.`cadence` = 'monthly' AND `pay_anchor`.`day_of_month` IS NOT NULL AND `pay_anchor`.`day_of_month` BETWEEN 1 AND 31))
) STRICT;
--> statement-breakpoint
ALTER TABLE `household_settings` ADD `household_pay_anchor_person_id` text REFERENCES person(id);
