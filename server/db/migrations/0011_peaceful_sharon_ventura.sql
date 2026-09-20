CREATE TABLE "ebook_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'ebook' NOT NULL,
	"product_id" text NOT NULL,
	"title" text NOT NULL,
	"market" text,
	"status" text NOT NULL,
	"target_pages" integer NOT NULL,
	"request" jsonb NOT NULL,
	"outline" jsonb,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sections_done" integer DEFAULT 0 NOT NULL,
	"sections_total" integer DEFAULT 0 NOT NULL,
	"words_written" integer DEFAULT 0 NOT NULL,
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
ALTER TABLE "ebook_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ebook_jobs" ADD CONSTRAINT "ebook_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ebook_jobs_user_idx" ON "ebook_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ebook_jobs_one_active" ON "ebook_jobs" USING btree ("user_id") WHERE "ebook_jobs"."status" in ('queued', 'outline', 'writing');