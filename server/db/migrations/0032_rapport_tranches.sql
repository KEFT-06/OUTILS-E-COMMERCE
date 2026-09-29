ALTER TABLE "report_documents" ADD COLUMN "outline" jsonb;--> statement-breakpoint
ALTER TABLE "report_documents" ADD COLUMN "sections" jsonb;--> statement-breakpoint
ALTER TABLE "report_documents" ADD COLUMN "lease_until" timestamp with time zone;