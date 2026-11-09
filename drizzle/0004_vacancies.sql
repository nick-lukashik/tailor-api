CREATE TABLE "vacancies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"url" text,
	"url_key" text,
	"raw_text" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"parse_status" text DEFAULT 'pending' NOT NULL,
	"parsed" jsonb,
	"parse_error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vacancies_url_key_key" UNIQUE("url_key"),
	CONSTRAINT "vacancies_url_with_key" CHECK (("vacancies"."url" is null) = ("vacancies"."url_key" is null)),
	CONSTRAINT "vacancies_url_length" CHECK (char_length("vacancies"."url") <= 2048),
	CONSTRAINT "vacancies_raw_text_length" CHECK (char_length("vacancies"."raw_text") <= 100000),
	CONSTRAINT "vacancies_title_length" CHECK (char_length("vacancies"."title") <= 200),
	CONSTRAINT "vacancies_company_length" CHECK (char_length("vacancies"."company") <= 200),
	CONSTRAINT "vacancies_parse_status" CHECK ("vacancies"."parse_status" in ('pending', 'parsed', 'failed')),
	CONSTRAINT "vacancies_parse_error_length" CHECK (char_length("vacancies"."parse_error") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "applications" DROP CONSTRAINT "applications_company_length";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "vacancy_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_user_id_vacancy_id_key" ON "applications" USING btree ("user_id","vacancy_id");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_company_length" CHECK (char_length("applications"."company") <= 200);