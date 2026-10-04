ALTER TABLE "storybooks" ADD COLUMN "engine" text;--> statement-breakpoint
ALTER TABLE "storybooks" ADD COLUMN "brief" jsonb;--> statement-breakpoint
ALTER TABLE "storybooks" ADD COLUMN "illustrated" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "storybooks" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storybooks" ADD COLUMN "slices" integer DEFAULT 0 NOT NULL;