CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`is_private` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "account_type" CHECK("account"."type" IN ('transaction', 'savings', 'offset', 'credit_card', 'home_loan', 'brokerage', 'super', 'property', 'vehicle', 'other')),
	CONSTRAINT "account_is_private" CHECK("account"."is_private" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `account_owner` (
	`account_id` text NOT NULL,
	`person_id` text NOT NULL,
	`share_bp` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `person_id`),
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_owner_share_bp" CHECK("account_owner"."share_bp" BETWEEN 1 AND 10000)
) STRICT;
--> statement-breakpoint
CREATE INDEX `account_owner_person_idx` ON `account_owner` (`person_id`);--> statement-breakpoint
CREATE TABLE `split` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`category_id` text,
	`beneficiary` text NOT NULL,
	`property_id` text,
	`tax_category_id` text,
	`memo` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `split_transaction_idx` ON `split` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`posted_on` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`description_raw` text NOT NULL,
	`payee_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transaction_status" CHECK("transaction"."status" IN ('pending', 'posted')),
	CONSTRAINT "transaction_posted_on" CHECK("transaction"."posted_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
) STRICT;
--> statement-breakpoint
CREATE INDEX `transaction_account_posted_idx` ON `transaction` (`account_id`,`posted_on`);