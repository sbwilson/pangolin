ALTER TABLE `import_batch` ADD `reconcile_status` text;--> statement-breakpoint
ALTER TABLE `import_batch` ADD `reconcile_gap_cents` integer;--> statement-breakpoint
ALTER TABLE `import_batch` ADD `first_posted_on` text;--> statement-breakpoint
ALTER TABLE `import_batch` ADD `last_posted_on` text;--> statement-breakpoint
UPDATE `import_batch` SET
	`first_posted_on` = (SELECT MIN(`posted_on`) FROM `transaction` WHERE `transaction`.`import_id` = `import_batch`.`id`),
	`last_posted_on` = (SELECT MAX(`posted_on`) FROM `transaction` WHERE `transaction`.`import_id` = `import_batch`.`id`);