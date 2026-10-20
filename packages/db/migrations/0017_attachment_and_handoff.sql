CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_name_idx` ON `attachment` (`name`);--> statement-breakpoint
CREATE TABLE `import_handoff` (
	`id` text PRIMARY KEY NOT NULL,
	`attachment_id` text,
	`sender_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`filename` text NOT NULL,
	`format` text NOT NULL,
	`csv_mapping` text,
	`status` text NOT NULL,
	`batch_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batch`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_handoff_status" CHECK("import_handoff"."status" IN ('pending', 'imported', 'dismissed')),
	CONSTRAINT "import_handoff_batch" CHECK(("import_handoff"."status" = 'imported') = ("import_handoff"."batch_id" IS NOT NULL)),
	CONSTRAINT "import_handoff_people" CHECK("import_handoff"."sender_id" <> "import_handoff"."recipient_id")
) STRICT;
--> statement-breakpoint
CREATE INDEX `import_handoff_sender_idx` ON `import_handoff` (`sender_id`);--> statement-breakpoint
CREATE INDEX `import_handoff_recipient_idx` ON `import_handoff` (`recipient_id`);--> statement-breakpoint
CREATE INDEX `import_handoff_attachment_idx` ON `import_handoff` (`attachment_id`);