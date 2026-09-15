import { defineConfig } from 'drizzle-kit';

/**
 * Génération des migrations SQL : `npm run db:generate` après toute modification de
 * server/db/schema.ts. Les migrations sont appliquées au démarrage du serveur.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './drizzle',
  strict: true,
});
