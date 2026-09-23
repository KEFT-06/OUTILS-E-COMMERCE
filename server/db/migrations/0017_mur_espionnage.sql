CREATE TABLE "spied_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"store_host" text NOT NULL,
	"landing_url" text NOT NULL,
	"title" text,
	"body_text" text,
	"advertiser" text,
	"media_url" text,
	"media_kind" text,
	"started_at" timestamp with time zone,
	"variants" integer DEFAULT 1 NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spied_ads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "spied_ads_external_unique" ON "spied_ads" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "spied_ads_started_idx" ON "spied_ads" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "spied_ads_store_idx" ON "spied_ads" USING btree ("store_host");