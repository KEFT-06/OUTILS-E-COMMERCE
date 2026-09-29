ALTER TABLE "report_documents" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "report_documents" ADD COLUMN "retry_after" timestamp with time zone;