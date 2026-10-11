ALTER TABLE "payment_checkouts" ADD COLUMN "provider" text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_checkouts" ADD COLUMN "operator" text;--> statement-breakpoint
ALTER TABLE "payment_checkouts" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "payment_checkouts" ADD COLUMN "phone_hint" text;--> statement-breakpoint
ALTER TABLE "payment_checkouts" ADD COLUMN "provider_ref" text;