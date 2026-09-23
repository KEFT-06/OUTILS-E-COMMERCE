CREATE TABLE "creative_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"prompt" text NOT NULL,
	"format" text NOT NULL,
	"mime_type" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creative_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creative_images" ADD CONSTRAINT "creative_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creative_images_request_unique" ON "creative_images" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "creative_images_user_idx" ON "creative_images" USING btree ("user_id","created_at");