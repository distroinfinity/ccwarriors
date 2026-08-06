-- Lock order matters: this migration runs in one transaction against a live
-- fleet whose ingest transactions lock users (UPDATE) and then snapshots
-- (INSERT). Index users first / snapshots second to match that order — the
-- reverse deadlocked against in-flight syncs on first deploy (40P01).
CREATE INDEX IF NOT EXISTS "users_cli_token_hash" ON "users" USING btree ("cli_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_github_login_lower" ON "users" USING btree (lower("github_login"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshots_user_captured" ON "snapshots" USING btree ("user_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshots_captured_at" ON "snapshots" USING btree ("captured_at");
