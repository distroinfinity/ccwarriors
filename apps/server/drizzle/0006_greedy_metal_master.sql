CREATE TABLE IF NOT EXISTS "user_deep_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"machine_id" text NOT NULL,
	"sessions" jsonb NOT NULL,
	"window_days" bigint DEFAULT 40 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "insights_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_deep_sessions" ADD CONSTRAINT "user_deep_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_deep_sessions_user_machine" ON "user_deep_sessions" USING btree ("user_id","machine_id");