import { env, listenHost, providers } from '@server/env';
import { closeDatabase, databaseKind, initDatabase } from '@server/db/client';
import { createApp } from '@server/app';
import { startExchangeRateRefresher, stopExchangeRateRefresher } from '@server/services/currency';
import { startSessionSweeper } from '@server/services/auth/sessions';
import { startGenerationSweeper } from '@server/services/generations/sweeper';

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

// Reprend le suivi des générations dont l'écran a été fermé avant la fin.
const stopSweeper = startGenerationSweeper();

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
    stopExchangeRateRefresher();
    server.close(() => {
      void closeDatabase().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
