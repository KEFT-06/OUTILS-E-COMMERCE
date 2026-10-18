CREATE TABLE "spied_pages" (
	"page_id" text PRIMARY KEY NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ads" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spied_pages" ENABLE ROW LEVEL SECURITY;