CREATE TABLE "discovered_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host" text NOT NULL,
	"label" text,
	"ad_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovered_stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "radar_alerts_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "radar_alerted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "discovered_stores_host_unique" ON "discovered_stores" USING btree ("host");--> statement-breakpoint
CREATE INDEX "discovered_stores_seen_idx" ON "discovered_stores" USING btree ("last_seen_at");