CREATE TABLE "report_documents" (
	"report_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"markdown" text,
	"title" text,
	"compliance" jsonb,
	"error_code" text,
	"error_message" text,
	"model" text,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"debit_transaction_id" uuid,
	"refunded" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "research_memo" text;--> statement-breakpoint
ALTER TABLE "report_documents" ADD CONSTRAINT "report_documents_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_documents" ADD CONSTRAINT "report_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_documents_user_idx" ON "report_documents" USING btree ("user_id");