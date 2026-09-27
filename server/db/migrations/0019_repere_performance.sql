CREATE TABLE "performance_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"niche" text NOT NULL,
	"market" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"day" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "performance_contributions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "performance_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "performance_contributions" ADD CONSTRAINT "performance_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "performance_contributions_day_unique" ON "performance_contributions" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "performance_contributions_group_idx" ON "performance_contributions" USING btree ("niche","market");