CREATE TABLE "profile_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_snapshots_user_id_version_key" UNIQUE("user_id","version"),
	CONSTRAINT "profile_snapshots_version" CHECK ("profile_snapshots"."version" >= 1),
	CONSTRAINT "profile_snapshots_sha256" CHECK ("profile_snapshots"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"person" jsonb NOT NULL,
	"career" jsonb NOT NULL,
	"employments" jsonb NOT NULL,
	"cases" jsonb NOT NULL,
	"skills" jsonb NOT NULL,
	"education" jsonb NOT NULL,
	"languages" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"story" jsonb NOT NULL,
	"application_facts" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"voice" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_version" CHECK ("profiles"."version" >= 1)
);
