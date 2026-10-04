CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`budget_cents` integer,
	`scope_person_id` text,
	`origin_account_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`scope_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "activity_budget_cents" CHECK("activity"."budget_cents" IS NULL OR "activity"."budget_cents" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_name_shared_idx` ON `activity` (`name`) WHERE scope_person_id IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `activity_name_scoped_idx` ON `activity` (`scope_person_id`,`name`) WHERE scope_person_id IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `balance_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`as_of` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "balance_snapshot_source" CHECK("balance_snapshot"."source" IN ('statement', 'api', 'manual')),
	CONSTRAINT "balance_snapshot_as_of" CHECK("balance_snapshot"."as_of" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
) STRICT;
--> statement-breakpoint
CREATE INDEX `balance_snapshot_account_as_of_idx` ON `balance_snapshot` (`account_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `category` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`is_fixed_cost` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`group_id`) REFERENCES `category_group`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "category_is_fixed_cost" CHECK("category"."is_fixed_cost" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE INDEX `category_group_idx` ON `category` (`group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `category_group_name_live_idx` ON `category` (`group_id`,`name`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `category_group` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`sort` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "category_group_kind" CHECK("category_group"."kind" IN ('income', 'expense', 'transfer'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `category_group_name_idx` ON `category_group` (`name`);--> statement-breakpoint
CREATE TABLE `institution` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`website_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "institution_kind" CHECK("institution"."kind" IN ('bank', 'broker', 'super_fund', 'other'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `payee` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website_url` text,
	`logo_attachment_id` text,
	`default_category_id` text,
	`scope_person_id` text,
	`origin_account_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`default_category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scope_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `payee_name_shared_idx` ON `payee` (`name`) WHERE scope_person_id IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `payee_name_scoped_idx` ON `payee` (`scope_person_id`,`name`) WHERE scope_person_id IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `payee_default_category_idx` ON `payee` (`default_category_id`);--> statement-breakpoint
CREATE TABLE `payee_alias` (
	`id` text PRIMARY KEY NOT NULL,
	`pattern` text NOT NULL,
	`match_kind` text NOT NULL,
	`payee_id` text NOT NULL,
	`scope_person_id` text,
	`origin_account_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`payee_id`) REFERENCES `payee`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scope_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payee_alias_match_kind" CHECK("payee_alias"."match_kind" IN ('exact', 'contains', 'prefix', 'regex'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `payee_alias_pattern_shared_idx` ON `payee_alias` (`match_kind`,`pattern`) WHERE scope_person_id IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `payee_alias_pattern_scoped_idx` ON `payee_alias` (`scope_person_id`,`match_kind`,`pattern`) WHERE scope_person_id IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `payee_alias_payee_idx` ON `payee_alias` (`payee_id`);--> statement-breakpoint
CREATE TABLE `split_tag` (
	`split_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`split_id`, `tag_id`),
	FOREIGN KEY (`split_id`) REFERENCES `split`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `split_tag_tag_idx` ON `split_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope_person_id` text,
	`origin_account_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`scope_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_shared_idx` ON `tag` (`name`) WHERE scope_person_id IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_scoped_idx` ON `tag` (`scope_person_id`,`name`) WHERE scope_person_id IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `tax_category` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`default_deductible_bp` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tax_category_default_deductible_bp" CHECK("tax_category"."default_deductible_bp" BETWEEN 0 AND 10000)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_category_code_idx` ON `tax_category` (`code`);--> statement-breakpoint
CREATE TABLE `transfer_group` (
	`id` text PRIMARY KEY NOT NULL,
	`matched_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "transfer_group_matched_by" CHECK("transfer_group"."matched_by" IN ('rule', 'manual', 'auto'))
) STRICT;
--> statement-breakpoint
ALTER TABLE `account` ADD `institution_id` text REFERENCES `institution`(`id`);--> statement-breakpoint
ALTER TABLE `account` ADD `opened_on` text;--> statement-breakpoint
ALTER TABLE `account` ADD `closed_on` text;--> statement-breakpoint
ALTER TABLE `account` ADD `is_savings` integer DEFAULT false NOT NULL CONSTRAINT "account_is_savings" CHECK(`is_savings` IN (0, 1));--> statement-breakpoint
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
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`activity_id`) REFERENCES `activity`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_category_id`) REFERENCES `tax_category`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "split_deductible_bp" CHECK("__new_split"."deductible_bp" IS NULL OR "__new_split"."deductible_bp" BETWEEN 0 AND 10000)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_split`("id", "transaction_id", "amount_cents", "category_id", "activity_id", "beneficiary", "property_id", "tax_category_id", "deductible_bp", "memo", "created_at", "updated_at") SELECT "id", "transaction_id", "amount_cents", "category_id", NULL, "beneficiary", "property_id", "tax_category_id", NULL, "memo", "created_at", "updated_at" FROM `split`;--> statement-breakpoint
DROP TABLE `split`;--> statement-breakpoint
ALTER TABLE `__new_split` RENAME TO `split`;--> statement-breakpoint
CREATE INDEX `split_transaction_idx` ON `split` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `split_category_idx` ON `split` (`category_id`);--> statement-breakpoint
CREATE INDEX `split_activity_idx` ON `split` (`activity_id`);--> statement-breakpoint
CREATE TABLE `__new_transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`posted_on` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`description_raw` text NOT NULL,
	`payee_id` text,
	`status` text NOT NULL,
	`external_id` text,
	`fingerprint` text NOT NULL,
	`fingerprint_version` integer NOT NULL,
	`import_id` text,
	`performed_by` text,
	`transfer_group_id` text,
	`needs_review` integer DEFAULT false NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`name_hidden_by` text,
	`name_hidden_until` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payee_id`) REFERENCES `payee`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`performed_by`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transfer_group_id`) REFERENCES `transfer_group`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`name_hidden_by`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transaction_needs_review" CHECK("__new_transaction"."needs_review" IN (0, 1)),
	CONSTRAINT "transaction_is_hidden" CHECK("__new_transaction"."is_hidden" IN (0, 1)),
	CONSTRAINT "transaction_status" CHECK("__new_transaction"."status" IN ('pending', 'posted')),
	CONSTRAINT "transaction_posted_on" CHECK("__new_transaction"."posted_on" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_transaction`("id", "account_id", "posted_on", "amount_cents", "description_raw", "payee_id", "status", "external_id", "fingerprint", "fingerprint_version", "import_id", "performed_by", "transfer_group_id", "needs_review", "is_hidden", "name_hidden_by", "name_hidden_until", "notes", "created_at", "updated_at", "deleted_at") SELECT "id", "account_id", "posted_on", "amount_cents", "description_raw", "payee_id", "status", NULL, "id", 0, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, "created_at", "updated_at", "deleted_at" FROM `transaction`;--> statement-breakpoint
DROP TABLE `transaction`;--> statement-breakpoint
ALTER TABLE `__new_transaction` RENAME TO `transaction`;--> statement-breakpoint
CREATE INDEX `transaction_account_posted_idx` ON `transaction` (`account_id`,`posted_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_account_external_id_idx` ON `transaction` (`account_id`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_account_fingerprint_idx` ON `transaction` (`account_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `transaction_payee_idx` ON `transaction` (`payee_id`);--> statement-breakpoint
CREATE INDEX `transaction_transfer_group_idx` ON `transaction` (`transfer_group_id`);--> statement-breakpoint
CREATE TABLE `__new_review_item` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`account_id` text,
	`person_id` text,
	`entity_ref` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolution` text,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_item_resolution" CHECK(("__new_review_item"."resolved_at" IS NULL) = ("__new_review_item"."resolution" IS NULL)),
	CONSTRAINT "review_item_scope" CHECK("__new_review_item"."account_id" IS NULL OR "__new_review_item"."person_id" IS NULL)
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_review_item`("id", "kind", "account_id", "person_id", "entity_ref", "dedupe_key", "created_at", "resolved_at", "resolution") SELECT "id", "kind", "account_id", "person_id", "entity_ref", "dedupe_key", "created_at", "resolved_at", "resolution" FROM `review_item`;--> statement-breakpoint
DROP TABLE `review_item`;--> statement-breakpoint
ALTER TABLE `__new_review_item` RENAME TO `review_item`;--> statement-breakpoint
CREATE UNIQUE INDEX `review_item_dedupe_key_open_idx` ON `review_item` (`dedupe_key`) WHERE resolved_at IS NULL;