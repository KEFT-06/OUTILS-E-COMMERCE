CREATE TABLE "session_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"device" text NOT NULL,
	"ip_masked" text,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text
);
--> statement-breakpoint
ALTER TABLE "session_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_history" ADD CONSTRAINT "session_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_history_session_unique" ON "session_history" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_history_user_idx" ON "session_history" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "session_history_started_idx" ON "session_history" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "session_history_last_seen_idx" ON "session_history" USING btree ("last_seen_at");--> statement-breakpoint
-- Sessions ouvertes avant l'historique : elles y entrent avec leur heure de connexion.
INSERT INTO "session_history" ("session_id", "user_id", "device", "ip_masked", "started_at", "last_seen_at")
SELECT "id", "user_id", 'Appareil non renseigné', NULL, "created_at", "last_seen_at" FROM "sessions";
