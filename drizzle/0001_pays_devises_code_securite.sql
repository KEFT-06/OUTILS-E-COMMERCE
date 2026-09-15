ALTER TABLE "payments" ADD COLUMN "currency" text DEFAULT 'XAF' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "amount_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "security_code_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "security_code_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "country" text;--> statement-breakpoint
-- Paiements antérieurs : saisis en francs CFA, le montant d'origine est l'équivalent enregistré.
UPDATE "payments" SET "amount_minor" = "amount_fcfa" WHERE "amount_minor" = 0;
