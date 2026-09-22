import { env, listenHost, providers } from '@server/env';
import { closeDatabase, databaseKind, initDatabase } from '@server/db/client';
import { createApp } from '@server/app';
import { startExchangeRateRefresher, stopExchangeRateRefresher } from '@server/services/currency';
import { startSessionSweeper } from '@server/services/auth/sessions';
import { startGenerationSweeper } from '@server/services/generations/sweeper';
import { startRadarSweeper } from '@server/services/radar/sweeper';
import { bootstrapFirstAdmin } from '@server/services/admin/bootstrap';
import { resumeAnalysisJobs } from '@server/services/analysis/jobs';
import { resumeEbookJobs } from '@server/services/writing/ebookJobs';

/* -------------------------------------------------------------------------- */
/*  Démarrage                                                                  */
/* -------------------------------------------------------------------------- */

// La base passe avant l'écoute : un serveur qui accepterait des connexions sans
// pouvoir vérifier une session échouerait sur chaque requête.
try {
  await initDatabase();
} catch (error) {
  console.error('\n❌ Base de données inaccessible :', error instanceof Error ? error.message : error);
  process.exit(1);
}

if (env.ADMIN_BOOTSTRAP_EMAIL) {
  await bootstrapFirstAdmin(env.ADMIN_BOOTSTRAP_EMAIL).catch((error: unknown) => {
    console.error('\n❌ Premier administrateur impossible à créer :', error instanceof Error ? error.message : error);
  });
}

const app = createApp();

const server = app.listen(env.PORT, listenHost, () => {
  const configured = Object.entries(providers)
    .filter(([, ok]) => ok)
    .map(([name]) => name);

  console.log(`\n  Smart Creator — API sur http://${listenHost}:${env.PORT}`);
  console.log(`  Environnement : ${env.NODE_ENV}`);
  console.log(
    `  Base de données : ${
      databaseKind() === 'postgres'
        ? 'PostgreSQL distant'
        : 'PostgreSQL embarqué (.data/pglite), réservé au développement'
    }`,
  );
  console.log(
    `  Fournisseurs configurés : ${configured.length > 0 ? configured.join(', ') : 'aucun'}`,
  );
  if (configured.length === 0) {
    console.log('  → Les routes de génération répondront 503 tant qu’aucune clé n’est fournie.');
  }
  console.log('');
});

// Analyses de niche interrompues par un redémarrage : l'étude se poursuit chez le moteur de
// recherche, le suivi reprend.
void resumeAnalysisJobs()
  .then((count) => {
    if (count > 0) console.log(`  Analyses reprises après redémarrage : ${count}`);
  })
  .catch((error: unknown) => console.error('❌ Reprise des analyses impossible :', error instanceof Error ? error.message : error));

// Ebooks longs interrompus : les sections déjà rédigées sont gardées, la suite repart.
void resumeEbookJobs()
  .then((count) => {
    if (count > 0) console.log(`  Rédactions d'ebooks reprises après redémarrage : ${count}`);
  })
  .catch((error: unknown) => console.error('❌ Reprise des rédactions impossible :', error instanceof Error ? error.message : error));

// Reprend le suivi des générations dont l'écran a été fermé avant la fin.
const stopSweeper = startGenerationSweeper();

// Le radar ne dort pas : il relève chaque boutique surveillée une fois par jour, sans
// que personne n'ouvre l'écran. C'est ce passage nocturne qui constitue l'historique.
const stopRadarSweeper = startRadarSweeper();

// Clôt dans l'historique les sessions abandonnées (onglet fermé sans déconnexion).
const stopSessionSweeper = startSessionSweeper();

// Taux de change du jour, pour afficher les prix dans la devise de chaque pays.
startExchangeRateRefresher();

// Arrêt propre : sans cela, un déploiement coupe les requêtes en cours.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`\n  ${signal} reçu, arrêt en cours…`);
    stopSweeper();
    stopSessionSweeper();
    stopRadarSweeper();
    stopExchangeRateRefresher();
    server.close(() => {
      void closeDatabase().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
