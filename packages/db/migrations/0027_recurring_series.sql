CREATE TABLE `recurring_series` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`payee_id` text NOT NULL,
	`direction` text NOT NULL,
	`cadence` text NOT NULL,
	`expected_cents` integer NOT NULL,
	`tolerance_bp` integer DEFAULT 1500 NOT NULL,
	`next_due_on` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payee_id`) REFERENCES `payee`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `recurring_series_direction` CHECK(`recurring_series`.`direction` IN ('bill', 'income')),
	CONSTRAINT `recurring_series_cadence` CHECK(`recurring_series`.`cadence` IN ('weekly', 'fortnightly', 'monthly', 'quarterly', 'annual')),
	CONSTRAINT `recurring_series_expected_cents` CHECK(`recurring_series`.`expected_cents` > 0),
	CONSTRAINT `recurring_series_tolerance_bp` CHECK(`recurring_series`.`tolerance_bp` >= 0),
	CONSTRAINT `recurring_series_status` CHECK(`recurring_series`.`status` IN ('candidate', 'confirmed', 'rejected'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `recurring_series_account_idx` ON `recurring_series` (`account_id`);--> statement-breakpoint
CREATE INDEX `recurring_series_payee_idx` ON `recurring_series` (`payee_id`);--> statement-breakpoint
CREATE INDEX `recurring_series_status_idx` ON `recurring_series` (`status`);
