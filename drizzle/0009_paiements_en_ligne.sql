CREATE TABLE "payment_checkouts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"plan" "plan_id" NOT NULL,
	"period_months" integer NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payment_checkouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_checkouts" ADD CONSTRAINT "payment_checkouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_checkouts_user_idx" ON "payment_checkouts" USING btree ("user_id","created_at");