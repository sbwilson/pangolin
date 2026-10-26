CREATE TABLE `suggestion` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`split_id` text NOT NULL,
	`source` text NOT NULL,
	`field` text NOT NULL,
	`suggested_value` text NOT NULL,
	`payee_name` text,
	`website_domain` text,
	`tax_category_id` text,
	`activity_id` text,
	`confidence` real,
	`model` text,
	`prompt_version` text,
	`outcome` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`split_id`) REFERENCES `split`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_category_id`) REFERENCES `tax_category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`activity_id`) REFERENCES `activity`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "suggestion_source" CHECK("suggestion"."source" IN ('llm', 'activity', 'rule_offer')),
	CONSTRAINT "suggestion_outcome" CHECK("suggestion"."outcome" IN ('open', 'accepted', 'superseded', 'rejected')),
	CONSTRAINT "suggestion_confidence" CHECK("suggestion"."confidence" IS NULL OR ("suggestion"."confidence" >= 0 AND "suggestion"."confidence" <= 1))
) STRICT;
--> statement-breakpoint
CREATE INDEX `suggestion_account_idx` ON `suggestion` (`account_id`);
--> statement-breakpoint
CREATE INDEX `suggestion_transaction_idx` ON `suggestion` (`transaction_id`);
--> statement-breakpoint
CREATE INDEX `suggestion_split_idx` ON `suggestion` (`split_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_split_field_open_idx` ON `suggestion` (`split_id`, `field`) WHERE `resolved_at` IS NULL;
