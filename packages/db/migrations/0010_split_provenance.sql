CREATE TABLE `__new_split` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`category_id` text,
	`activity_id` text,
	`beneficiary` text NOT NULL,
	`property_id` text,
	`tax_category_id` text,
	`deductible_bp` integer,
	`memo` text,
	`category_source` text,
	`activity_source` text,
	`tax_category_source` text,
	`beneficiary_source` text,
	`deductible_bp_source` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`activity_id`) REFERENCES `activity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_category_id`) REFERENCES `tax_category`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "split_deductible_bp" CHECK("__new_split"."deductible_bp" IS NULL OR "__new_split"."deductible_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "split_category_source" CHECK("__new_split"."category_source" IS NULL OR "__new_split"."category_source" IN ('user', 'rule', 'payee', 'activity', 'llm')),
	CONSTRAINT "split_activity_source" CHECK("__new_split"."activity_source" IS NULL OR "__new_split"."activity_source" IN ('user', 'rule', 'payee', 'activity', 'llm')),
	CONSTRAINT "split_tax_category_source" CHECK("__new_split"."tax_category_source" IS NULL OR "__new_split"."tax_category_source" IN ('user', 'rule', 'payee', 'activity', 'llm')),
	CONSTRAINT "split_beneficiary_source" CHECK("__new_split"."beneficiary_source" IS NULL OR "__new_split"."beneficiary_source" IN ('user', 'rule', 'payee', 'activity', 'llm')),
	CONSTRAINT "split_deductible_bp_source" CHECK("__new_split"."deductible_bp_source" IS NULL OR "__new_split"."deductible_bp_source" IN ('user', 'rule', 'payee', 'activity', 'llm')),
	CONSTRAINT "split_beneficiary" CHECK(length("__new_split"."beneficiary") > 0)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_split`("id", "transaction_id", "amount_cents", "category_id", "activity_id", "beneficiary", "property_id", "tax_category_id", "deductible_bp", "memo", "created_at", "updated_at") SELECT "id", "transaction_id", "amount_cents", "category_id", "activity_id", "beneficiary", "property_id", "tax_category_id", "deductible_bp", "memo", "created_at", "updated_at" FROM `split`;--> statement-breakpoint
DROP TABLE `split`;--> statement-breakpoint
ALTER TABLE `__new_split` RENAME TO `split`;--> statement-breakpoint
CREATE INDEX `split_transaction_idx` ON `split` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `split_category_idx` ON `split` (`category_id`);--> statement-breakpoint
CREATE INDEX `split_activity_idx` ON `split` (`activity_id`);