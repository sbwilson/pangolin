CREATE TABLE `budget` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`category_id` text,
	`category_group_id` text,
	`cadence` text NOT NULL,
	`limit_cents` integer NOT NULL,
	`rollover` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_group_id`) REFERENCES `category_group`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `budget_cadence` CHECK(`budget`.`cadence` IN ('fortnight', 'month')),
	CONSTRAINT `budget_limit_cents` CHECK(`budget`.`limit_cents` > 0),
	CONSTRAINT `budget_rollover` CHECK(`budget`.`rollover` IN (0, 1)),
	CONSTRAINT `budget_target_check` CHECK((`budget`.`category_id` IS NOT NULL AND `budget`.`category_group_id` IS NULL) OR (`budget`.`category_id` IS NULL AND `budget`.`category_group_id` IS NOT NULL))
) STRICT;
--> statement-breakpoint
CREATE INDEX `budget_person_idx` ON `budget` (`person_id`);--> statement-breakpoint
CREATE INDEX `budget_category_idx` ON `budget` (`category_id`);--> statement-breakpoint
CREATE INDEX `budget_category_group_idx` ON `budget` (`category_group_id`);
