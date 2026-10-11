ALTER TABLE "guides" ADD COLUMN "source_kind" text;--> statement-breakpoint
ALTER TABLE "guides" ADD COLUMN "source_id" text;--> statement-breakpoint
CREATE INDEX "guides_source_idx" ON "guides" USING btree ("user_id","source_kind","source_id");