CREATE TABLE "provider_daily_usage" (
	"day" text NOT NULL,
	"provider" text NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "provider_daily_usage_day_provider_pk" PRIMARY KEY("day","provider")
);
--> statement-breakpoint
ALTER TABLE "provider_daily_usage" ENABLE ROW LEVEL SECURITY;