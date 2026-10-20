CREATE TABLE `import_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`source` text NOT NULL,
	`file_sha256` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`dup_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_batch_status" CHECK("import_batch"."status" IN ('staged', 'ready', 'committed', 'failed'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `import_batch_account_idx` ON `import_batch` (`account_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_batch_account_file_sha_idx` ON `import_batch` (`account_id`, `file_sha256`);
--> statement-breakpoint
CREATE TABLE `import_row` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`raw_line` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`pdf_page` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batch`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_row_status" CHECK("import_row"."status" IN ('staged', 'committed', 'set_aside', 'discarded'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `import_row_batch_idx` ON `import_row` (`batch_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_row_batch_row_number_idx` ON `import_row` (`batch_id`, `row_number`);
