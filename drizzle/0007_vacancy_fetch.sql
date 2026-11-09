ALTER TABLE "vacancies" ADD COLUMN "apply_form" jsonb;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "fetch_status" text DEFAULT 'skipped' NOT NULL;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "fetch_error" text;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_fetch_status" CHECK ("vacancies"."fetch_status" in ('pending', 'fetched', 'failed', 'skipped'));--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_fetch_error_length" CHECK (char_length("vacancies"."fetch_error") <= 100);