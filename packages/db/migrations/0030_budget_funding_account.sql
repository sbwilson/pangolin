ALTER TABLE `budget` ADD `funding_account_id` text REFERENCES account(id);--> statement-breakpoint
CREATE INDEX `budget_funding_account_idx` ON `budget` (`funding_account_id`);