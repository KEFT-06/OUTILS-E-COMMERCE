ALTER TABLE "ebook_jobs" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
-- Les rédactions déjà terminées sont tenues pour remises : leur texte a été versé au brouillon,
-- ou leur auteur a continué sans lui. Les proposer de nouveau écraserait un brouillon retravaillé depuis.
UPDATE "ebook_jobs" SET "delivered_at" = coalesce("completed_at", now()) WHERE "status" = 'completed';
