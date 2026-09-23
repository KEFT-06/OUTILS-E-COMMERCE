DROP INDEX "analysis_jobs_one_active";--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD COLUMN "retry_after" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_jobs_one_active" ON "analysis_jobs" USING btree ("user_id") WHERE "analysis_jobs"."status" in ('queued', 'research', 'writing', 'waiting');