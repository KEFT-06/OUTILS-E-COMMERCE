CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"topic" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_daily" (
	"day" text PRIMARY KEY NOT NULL,
	"salt" text,
	"uniques" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_visitors" (
	"day" text NOT NULL,
	"visitor" text NOT NULL,
	CONSTRAINT "site_visitors_day_visitor_pk" PRIMARY KEY("day","visitor")
);
--> statement-breakpoint
ALTER TABLE "site_visitors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_visits" (
	"day" text NOT NULL,
	"path" text NOT NULL,
	"referrer" text NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "site_visits_day_path_referrer_pk" PRIMARY KEY("day","path","referrer")
);
--> statement-breakpoint
ALTER TABLE "site_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_messages_status_idx" ON "contact_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "contact_messages_created_idx" ON "contact_messages" USING btree ("created_at");