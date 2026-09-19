CREATE TABLE "analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"query" text NOT NULL,
	"market" text,
	"status" text NOT NULL,
	"research_ref" text,
	"report_id" uuid,
	"error_code" text,
	"error_message" text,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"debit_transaction_id" uuid,
	"refunded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "analysis_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "storybooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"generation_ref" text NOT NULL,
	"gamma_id" text,
	"gamma_url" text,
	"title" text NOT NULL,
	"language" text NOT NULL,
	"country" text NOT NULL,
	"pages" integer NOT NULL,
	"story" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "storybooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storybooks" ADD CONSTRAINT "storybooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_jobs_user_idx" ON "analysis_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_jobs_one_active" ON "analysis_jobs" USING btree ("user_id") WHERE "analysis_jobs"."status" in ('queued', 'research', 'writing');--> statement-breakpoint
CREATE INDEX "storybooks_user_idx" ON "storybooks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "storybooks_generation_unique" ON "storybooks" USING btree ("generation_ref");