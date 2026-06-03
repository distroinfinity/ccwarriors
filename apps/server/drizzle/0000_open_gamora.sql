CREATE TABLE IF NOT EXISTS "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"cost_30d" numeric NOT NULL,
	"cost_all_time" numeric NOT NULL,
	"ccusage_version" text DEFAULT '' NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" text NOT NULL,
	"github_login" text NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"x_handle" text,
	"cli_token_hash" text NOT NULL,
	"card_scene" text DEFAULT 'fujiNight' NOT NULL,
	"cost_30d" numeric DEFAULT '0' NOT NULL,
	"cost_all_time" numeric DEFAULT '0' NOT NULL,
	"tier" text DEFAULT 'Stone' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
