CREATE TYPE "public"."watch_event_kind" AS ENUM('appeared', 'disappeared', 'price_changed', 'sales_jump');--> statement-breakpoint
CREATE TYPE "public"."watch_source" AS ENUM('chariow_store');--> statement-breakpoint
CREATE TABLE "watch_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watch_id" uuid NOT NULL,
	"item_id" uuid,
	"kind" "watch_event_kind" NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "watch_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "watch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watch_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"price_value" integer,
	"currency" text,
	"sales_count" integer,
	"sales_at_first_seen" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "watch_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "watch_source" NOT NULL,
	"external_id" text NOT NULL,
	"label" text NOT NULL,
	"url" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_swept_at" timestamp with time zone,
	"last_error" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "watch_events" ADD CONSTRAINT "watch_events_watch_id_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_events" ADD CONSTRAINT "watch_events_item_id_watch_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."watch_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_items" ADD CONSTRAINT "watch_items_watch_id_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watch_events_feed_idx" ON "watch_events" USING btree ("watch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_items_external_unique" ON "watch_items" USING btree ("watch_id","external_id");--> statement-breakpoint
CREATE INDEX "watch_items_alive_idx" ON "watch_items" USING btree ("watch_id","ended_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watches_target_unique" ON "watches" USING btree ("user_id","source","external_id");--> statement-breakpoint
CREATE INDEX "watches_sweep_idx" ON "watches" USING btree ("active","last_swept_at");