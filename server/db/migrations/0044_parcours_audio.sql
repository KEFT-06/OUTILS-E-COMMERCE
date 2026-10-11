ALTER TYPE "public"."generation_kind" ADD VALUE 'audio';--> statement-breakpoint
CREATE TABLE "audio_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"voice" text NOT NULL,
	"seconds" integer NOT NULL,
	"bytes" integer NOT NULL,
	"storage_path" text,
	"data" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audio_tracks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_tracks_subject_idx" ON "audio_tracks" USING btree ("user_id","subject_id","position");--> statement-breakpoint
CREATE INDEX "audio_tracks_expiry_idx" ON "audio_tracks" USING btree ("expires_at");