CREATE TABLE "ad_collection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_run_id" text NOT NULL,
	"dataset_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"urls" integer DEFAULT 0 NOT NULL,
	"ads_examined" integer,
	"ads_kept" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ad_collection_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spied_ads" ADD COLUMN "page_id" text;--> statement-breakpoint
ALTER TABLE "spied_ads" ADD COLUMN "page_url" text;--> statement-breakpoint
ALTER TABLE "spied_ads" ADD COLUMN "cta_text" text;--> statement-breakpoint
ALTER TABLE "spied_ads" ADD COLUMN "display_format" text;--> statement-breakpoint
ALTER TABLE "spied_ads" ADD COLUMN "link_caption" text;--> statement-breakpoint
ALTER TABLE "spied_ads" ADD COLUMN "link_description" text;--> statement-breakpoint
ALTER TABLE "spied_ads" ADD COLUMN "cards" jsonb;--> statement-breakpoint
ALTER TABLE "spied_ads" ADD COLUMN "thumbnail_path" text;--> statement-breakpoint
ALTER TABLE "spied_ads" ADD COLUMN "thumbnail_failed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_collection_runs_provider_unique" ON "ad_collection_runs" USING btree ("provider_run_id");--> statement-breakpoint
CREATE INDEX "ad_collection_runs_status_idx" ON "ad_collection_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "spied_ads_page_idx" ON "spied_ads" USING btree ("page_id");