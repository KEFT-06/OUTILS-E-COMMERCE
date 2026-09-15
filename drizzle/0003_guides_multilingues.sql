ALTER TYPE "public"."generation_kind" ADD VALUE 'guide_translation';--> statement-breakpoint
ALTER TYPE "public"."generation_kind" ADD VALUE 'cover';--> statement-breakpoint
CREATE TABLE "covers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"subject_id" text NOT NULL,
	"prompt" text NOT NULL,
	"status" text NOT NULL,
	"provider_ref" text,
	"mime_type" text,
	"data" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "covers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guide_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guide_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"language" text NOT NULL,
	"title" text NOT NULL,
	"sections" jsonb NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_revision" integer NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"author_validated_at" timestamp with time zone,
	"review_requested_at" timestamp with time zone,
	"review_note" text,
	"review_debit_id" uuid,
	"reviewer_id" uuid,
	"review_claimed_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewer_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guide_translations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_language" text NOT NULL,
	"sections" jsonb NOT NULL,
	"terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"cover_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reviewer_languages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "covers" ADD CONSTRAINT "covers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_translations" ADD CONSTRAINT "guide_translations_guide_id_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_translations" ADD CONSTRAINT "guide_translations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_translations" ADD CONSTRAINT "guide_translations_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guides" ADD CONSTRAINT "guides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "covers_subject_idx" ON "covers" USING btree ("user_id","subject","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guide_translations_language_unique" ON "guide_translations" USING btree ("guide_id","language");--> statement-breakpoint
CREATE INDEX "guide_translations_queue_idx" ON "guide_translations" USING btree ("status","language");--> statement-breakpoint
CREATE INDEX "guide_translations_reviewer_idx" ON "guide_translations" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "guides_user_idx" ON "guides" USING btree ("user_id","updated_at");