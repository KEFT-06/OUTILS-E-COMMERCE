import { closeDatabase, initDatabase } from '@server/db/client';
import { env } from '@server/env';

/**
 * Applique les migrations en attente, une seule fois, hors du serveur.
 *
 * En hébergement sans serveur (Vercel), chaque requête peut réveiller une instance neuve :
 * si chacune tentait de migrer, plusieurs migrations identiques partiraient ensemble sur la
 * même base. Les migrations passent donc pendant la construction, et le serveur démarre
 * ensuite sans y toucher (`initDatabase(url, { migrate: false })`).
 *
 * Sans DATABASE_URL, la commande ne fait rien et sort en succès : une construction qui ne
 * vise aucune base (aperçu, vérification locale) ne doit pas échouer pour autant.
 */

if (!env.DATABASE_URL) {
  console.log('  Migrations ignorées : aucune base distante (DATABASE_URL absent).');
  process.exit(0);
}

try {
  await initDatabase(env.DATABASE_URL, { migrate: true, maxConnections: 1 });
  console.log('  Migrations appliquées.');
  await closeDatabase();
  process.exit(0);
} catch (error) {
  console.error('\n❌ Migrations impossibles :', error instanceof Error ? error.message : error);
  process.exit(1);
}
