CREATE INDEX IF NOT EXISTS "snapshots_user_captured" ON "snapshots" USING btree ("user_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshots_captured_at" ON "snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_cli_token_hash" ON "users" USING btree ("cli_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_github_login_lower" ON "users" USING btree (lower("github_login"));