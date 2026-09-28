ALTER TABLE "generations" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "resolution" text;