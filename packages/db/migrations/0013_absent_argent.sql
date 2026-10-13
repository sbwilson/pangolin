DROP INDEX `split_transaction_idx`;--> statement-breakpoint
CREATE INDEX `split_transaction_idx` ON `split` (`transaction_id`,`category_id`);--> statement-breakpoint
DROP INDEX `transaction_account_posted_idx`;--> statement-breakpoint
DROP INDEX `transaction_payee_idx`;--> statement-breakpoint
CREATE INDEX `transaction_posted_id_idx` ON `transaction` (`posted_on`,`id`);--> statement-breakpoint
CREATE INDEX `transaction_account_posted_idx` ON `transaction` (`account_id`,`posted_on`,`id`);--> statement-breakpoint
CREATE INDEX `transaction_payee_idx` ON `transaction` (`payee_id`,`posted_on`,`id`);