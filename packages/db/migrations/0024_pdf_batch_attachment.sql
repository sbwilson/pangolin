ALTER TABLE `import_batch` ADD `attachment_id` text REFERENCES attachment(id);--> statement-breakpoint
ALTER TABLE `import_batch` ADD `statement_meta` text;