CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"level" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_external_id" text NOT NULL,
	"store_host" text NOT NULL,
	"store_label" text,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"slug" text,
	"kind" text,
	"category" text,
	"price_value" integer,
	"currency" text,
	"sales_count" integer,
	"sales_at_first_seen" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"launched_at" timestamp with time zone,
	"sales_at_day_3" integer,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "market_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "discovered_stores" ADD COLUMN "store_external_id" text;--> statement-breakpoint
ALTER TABLE "discovered_stores" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spied_ads" ADD COLUMN "download_url" text;--> statement-breakpoint
ALTER TABLE "spied_ads" ADD COLUMN "countries" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "spied_ads" ADD COLUMN "stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "alerts_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "watch_items" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "watch_items" ADD COLUMN "slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_dedupe_unique" ON "alerts" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "alerts_feed_idx" ON "alerts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_products_unique" ON "market_products" USING btree ("store_external_id","external_id");--> statement-breakpoint
CREATE INDEX "market_products_category_idx" ON "market_products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "market_products_launch_idx" ON "market_products" USING btree ("launched_at");--> statement-breakpoint
CREATE INDEX "market_products_host_idx" ON "market_products" USING btree ("store_host");