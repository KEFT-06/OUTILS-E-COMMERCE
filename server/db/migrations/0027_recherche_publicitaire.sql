CREATE TABLE "ad_search_results" (
	"search_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"ad" jsonb NOT NULL,
	CONSTRAINT "ad_search_results_search_id_position_pk" PRIMARY KEY("search_id","position")
);
--> statement-breakpoint
ALTER TABLE "ad_search_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ad_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"query_key" text NOT NULL,
	"country" text DEFAULT 'ALL' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"provider_run_id" text,
	"dataset_id" text,
	"requested_by" uuid,
	"results_limit" integer NOT NULL,
	"ads_found" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ad_searches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_search_results" ADD CONSTRAINT "ad_search_results_search_id_ad_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."ad_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_searches" ADD CONSTRAINT "ad_searches_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_searches_key_idx" ON "ad_searches" USING btree ("query_key","country","created_at");--> statement-breakpoint
CREATE INDEX "ad_searches_user_idx" ON "ad_searches" USING btree ("requested_by","created_at");