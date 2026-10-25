CREATE TABLE `llm_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`base_url` text NOT NULL,
	`model` text NOT NULL,
	`api_key_ciphertext` text,
	`api_key_last4` text,
	`is_local` integer DEFAULT 0 NOT NULL,
	`cloud_pdf` integer DEFAULT 0 NOT NULL,
	`cloud_rows` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "llm_provider_kind" CHECK("llm_provider"."kind" IN ('openai', 'anthropic')),
	CONSTRAINT "llm_provider_is_local" CHECK("llm_provider"."is_local" IN (0, 1)),
	CONSTRAINT "llm_provider_cloud_pdf" CHECK("llm_provider"."cloud_pdf" IN (0, 1)),
	CONSTRAINT "llm_provider_cloud_rows" CHECK("llm_provider"."cloud_rows" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `llm_purpose_assignment` (
	`purpose` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `llm_provider`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "llm_purpose_assignment_purpose" CHECK("llm_purpose_assignment"."purpose" IN ('categorise', 'pdf_extract', 'row_interpret'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `llm_purpose_assignment_provider_idx` ON `llm_purpose_assignment` (`provider_id`);
