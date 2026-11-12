CREATE TABLE `forecast_assumption` (
	`person_id` text PRIMARY KEY NOT NULL,
	`savings_rate_bps` integer DEFAULT 0 NOT NULL,
	`return_low_bps` integer DEFAULT 0 NOT NULL,
	`return_mid_bps` integer DEFAULT 0 NOT NULL,
	`return_high_bps` integer DEFAULT 0 NOT NULL,
	`super_rate_bps` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "forecast_assumption_savings_rate" CHECK("forecast_assumption"."savings_rate_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "forecast_assumption_return_low_rate" CHECK("forecast_assumption"."return_low_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "forecast_assumption_return_mid_rate" CHECK("forecast_assumption"."return_mid_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "forecast_assumption_return_high_rate" CHECK("forecast_assumption"."return_high_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "forecast_assumption_super_rate" CHECK("forecast_assumption"."super_rate_bps" BETWEEN 0 AND 10000)
) STRICT;
--> statement-breakpoint
CREATE TABLE `forecast_assumption_mortgage` (
	`person_id` text NOT NULL,
	`account_id` text NOT NULL,
	`count_offset` integer NOT NULL,
	PRIMARY KEY(`person_id`, `account_id`),
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "forecast_assumption_mortgage_count_offset" CHECK("forecast_assumption_mortgage"."count_offset" IN (0, 1))
) STRICT;
