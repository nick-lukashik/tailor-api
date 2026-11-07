CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"vacancy_url" text,
	"vacancy_text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_company_length" CHECK (char_length("applications"."company") between 1 and 200),
	CONSTRAINT "applications_role_length" CHECK (char_length("applications"."role") <= 200),
	CONSTRAINT "applications_vacancy_url_length" CHECK (char_length("applications"."vacancy_url") <= 2048),
	CONSTRAINT "applications_vacancy_text_length" CHECK (char_length("applications"."vacancy_text") <= 50000),
	CONSTRAINT "applications_status" CHECK ("applications"."status" in ('new', 'sent', 'interview', 'offer', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX "applications_created_at_id_idx" ON "applications" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);