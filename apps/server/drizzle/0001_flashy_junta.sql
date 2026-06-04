CREATE TABLE IF NOT EXISTS "usage_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"machine_id" text DEFAULT '' NOT NULL,
	"tool" text NOT NULL,
	"day" date NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"model_breakdown" jsonb,
	"cost" numeric DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "tool_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "client_build_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tool_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "client_build_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "has_breakdown" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "flag_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_days" ADD CONSTRAINT "usage_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usage_days_user_machine_tool_day" ON "usage_days" USING btree ("user_id","machine_id","tool","day");