PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`is_private` integer NOT NULL,
	`institution_id` text,
	`opened_on` text,
	`closed_on` text,
	`is_savings` integer DEFAULT false NOT NULL,
	`low_balance_threshold_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`institution_id`) REFERENCES `institution`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_type" CHECK("__new_account"."type" IN ('transaction', 'savings', 'offset', 'credit_card', 'home_loan', 'brokerage', 'super', 'property', 'vehicle', 'other')),
	CONSTRAINT "account_is_private" CHECK("__new_account"."is_private" IN (0, 1)),
	CONSTRAINT "account_is_savings" CHECK("__new_account"."is_savings" IN (0, 1)),
	CONSTRAINT "account_low_balance_threshold" CHECK("__new_account"."low_balance_threshold_cents" >= 0)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_account`("id", "name", "type", "currency", "is_private", "institution_id", "opened_on", "closed_on", "is_savings", "low_balance_threshold_cents", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "type", "currency", "is_private", "institution_id", "opened_on", "closed_on", "is_savings", 0, "created_at", "updated_at", "deleted_at" FROM `account`;--> statement-breakpoint
DROP TABLE `account`;--> statement-breakpoint
ALTER TABLE `__new_account` RENAME TO `account`;--> statement-breakpoint
PRAGMA foreign_keys=ON;