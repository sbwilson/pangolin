CREATE TABLE `allocation_stage` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`name` text NOT NULL,
	`sort` integer NOT NULL,
	`exit_goal_id` text,
	`fallback_threshold_bp` integer DEFAULT 8000 NOT NULL,
	`completed_share_policy` text DEFAULT 'rescale' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `allocation_stage_fallback_threshold_bp` CHECK(`allocation_stage`.`fallback_threshold_bp` >= 0 AND `allocation_stage`.`fallback_threshold_bp` <= 10000),
	CONSTRAINT `allocation_stage_completed_share_policy` CHECK(`allocation_stage`.`completed_share_policy` IN ('rescale', 'buffer'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `allocation_stage_person_idx` ON `allocation_stage` (`person_id`);--> statement-breakpoint
CREATE INDEX `allocation_stage_sort_idx` ON `allocation_stage` (`sort`);--> statement-breakpoint
CREATE TABLE `goal` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`name` text NOT NULL,
	`target_cents` integer NOT NULL,
	`target_date` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'flexible' NOT NULL,
	`is_emergency_fund` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `goal_target_cents` CHECK(`goal`.`target_cents` > 0),
	CONSTRAINT `goal_kind` CHECK(`goal`.`kind` IN ('flexible', 'protected')),
	CONSTRAINT `goal_is_emergency_fund` CHECK(`goal`.`is_emergency_fund` IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE INDEX `goal_person_idx` ON `goal` (`person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `goal_emergency_fund_idx` ON `goal` (coalesce(`person_id`, '__shared__')) WHERE `goal`.`is_emergency_fund` = 1;--> statement-breakpoint
CREATE TABLE `goal_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`stage_id` text NOT NULL,
	`share_bp` integer NOT NULL,
	`effective_from` text NOT NULL,
	`effective_until` text,
	`source` text DEFAULT 'rule' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goal`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stage_id`) REFERENCES `allocation_stage`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `goal_rule_share_bp` CHECK(`goal_rule`.`share_bp` >= 0 AND `goal_rule`.`share_bp` <= 10000),
	CONSTRAINT `goal_rule_source` CHECK(`goal_rule`.`source` IN ('rule', 'shortfall_override'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `goal_rule_goal_idx` ON `goal_rule` (`goal_id`);--> statement-breakpoint
CREATE INDEX `goal_rule_stage_idx` ON `goal_rule` (`stage_id`);--> statement-breakpoint
CREATE TABLE `goal_allocation` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`period_start` text NOT NULL,
	`allocated_cents` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goal`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `goal_allocation_goal_idx` ON `goal_allocation` (`goal_id`);--> statement-breakpoint
CREATE INDEX `goal_allocation_period_idx` ON `goal_allocation` (`period_start`);--> statement-breakpoint
CREATE TABLE `goal_drawdown` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`reason` text NOT NULL,
	`label` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`transaction_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`undone_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `goal_drawdown_reason` CHECK(`goal_drawdown`.`reason` IN ('large_purchase', 'shortfall')),
	CONSTRAINT `goal_drawdown_amount_cents` CHECK(`goal_drawdown`.`amount_cents` > 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX `goal_drawdown_person_idx` ON `goal_drawdown` (`person_id`);--> statement-breakpoint
CREATE INDEX `goal_drawdown_transaction_idx` ON `goal_drawdown` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `goal_adjustment` (
	`id` text PRIMARY KEY NOT NULL,
	`drawdown_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`drawdown_id`) REFERENCES `goal_drawdown`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goal_id`) REFERENCES `goal`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `goal_adjustment_amount_cents` CHECK(`goal_adjustment`.`amount_cents` > 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX `goal_adjustment_drawdown_idx` ON `goal_adjustment` (`drawdown_id`);--> statement-breakpoint
CREATE INDEX `goal_adjustment_goal_idx` ON `goal_adjustment` (`goal_id`);--> statement-breakpoint
CREATE TABLE `planning_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`large_withdrawal_threshold_cents` integer DEFAULT 200000 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `planning_setting_threshold_cents` CHECK(`planning_setting`.`large_withdrawal_threshold_cents` > 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX `planning_setting_person_idx` ON `planning_setting` (`person_id`);
