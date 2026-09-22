CREATE TABLE "niche_benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"source" text NOT NULL,
	"product_count" integer NOT NULL,
	"median_price" integer,
	"currency" text,
	"median_age_days" integer,
	"total_ratings" integer DEFAULT 0 NOT NULL,
	"sales_known_count" integer DEFAULT 0 NOT NULL,
	"median_sales" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "niche_benchmarks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "niche_benchmarks_query_unique" ON "niche_benchmarks" USING btree ("query","source");--> statement-breakpoint
CREATE INDEX "niche_benchmarks_collected_idx" ON "niche_benchmarks" USING btree ("created_at");