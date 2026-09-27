/**
 * Collecte publicitaire en ligne de commande.
 *
 * POURQUOI CE SCRIPT EXISTE. Il n'y avait jusqu'ici que deux façons de lancer une collecte :
 * le planificateur, qui exige `CRON_SECRET` posé sur l'hébergeur, et le bouton de
 * l'administration, qui exige une session ouverte avec double authentification. Ni l'un ni
 * l'autre ne sert quand on met le module en service, qu'on vérifie une clé, ou qu'on veut
 * remplir un mur vide une première fois. Un module qu'on ne peut pas amorcer à la main est un
 * module qu'on ne peut pas mettre en route.
 *
 *   npm run radar:collect                 collecte réelle, FACTURÉE par le fournisseur
 *   npm run radar:collect -- --from x.json  rejoue une collecte déjà payée, gratuitement
 *
 * LE MODE « --from » N'EST PAS UNE SIMULATION. Il emprunte exactement le chemin de la
 * collecte réelle — même lecture des annonces, mêmes écritures, mêmes conflits résolus. Seule
 * la source change : un fichier enregistré au lieu d'un appel facturé. Il sert à reverser une
 * collecte dans une autre base sans la repayer, et à examiner ce qu'une collecte a produit
 * sans en relancer une.
 */
import { readFileSync } from 'node:fs';
import { closeDatabase, initDatabase } from '@server/db/client';
import { env, providers } from '@server/env';
import { ingestDiscoveryItems, runDiscovery } from '@server/services/radar/discovery';

function fichierDemande(): string | null {
  const index = process.argv.indexOf('--from');
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main() {
  await initDatabase(env.DATABASE_URL, { migrate: true });

  const fichier = fichierDemande();
  const resultat = fichier
    ? await ingestDiscoveryItems(JSON.parse(readFileSync(fichier, 'utf8')) as unknown[])
    : await (async () => {
        if (!providers.apify) {
          throw new Error('APIFY_TOKEN absent : la collecte réelle est impossible sur ce serveur.');
        }
        console.log(`Collecte réelle chez ${env.APIFY_ADS_ACTOR}, plafond ${env.RADAR_DISCOVERY_LIMIT} annonces.`);
        console.log('Ce passage est FACTURÉ par le fournisseur.');
        return runDiscovery();
      })();

  console.log('');
  console.log(`  annonces examinées : ${resultat.adsExamined}`);
  console.log(`  annonces retenues  : ${resultat.adsKept}   (celles qui mènent vraiment à la plateforme)`);
  console.log(`  boutiques repérées : ${resultat.storesFound}, dont ${resultat.storesNew} nouvelle(s)`);
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await closeDatabase();
    process.exit(1);
  });
