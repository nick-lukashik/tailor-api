CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"application_id" uuid NOT NULL,
	"cv_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"model" text,
	"effort" text,
	"prompt_version" integer,
	"content" jsonb,
	"error" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_application_id_version_key" UNIQUE("application_id","version"),
	CONSTRAINT "materials_version" CHECK ("materials"."version" >= 1),
	CONSTRAINT "materials_status" CHECK ("materials"."status" in ('queued', 'generating', 'ready', 'failed')),
	CONSTRAINT "materials_error_length" CHECK (char_length("materials"."error") <= 100),
	CONSTRAINT "materials_ready_content" CHECK ("materials"."status" <> 'ready' or "materials"."content" is not null)
);
--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_cv_id_cvs_id_fk" FOREIGN KEY ("cv_id") REFERENCES "public"."cvs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "materials_cv_id_idx" ON "materials" USING btree ("cv_id");