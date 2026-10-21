ALTER TABLE `balance_snapshot` ADD `import_batch_id` text REFERENCES import_batch(id);--> statement-breakpoint
CREATE INDEX `balance_snapshot_import_batch_idx` ON `balance_snapshot` (`import_batch_id`);--> statement-breakpoint
ALTER TABLE `import_batch` ADD `opening_balance_cents` integer;--> statement-breakpoint
ALTER TABLE `import_batch` ADD `closing_balance_cents` integer;