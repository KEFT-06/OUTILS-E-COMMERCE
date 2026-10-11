import assert from 'node:assert/strict';
import { type AddressInfo, type Socket, createServer } from 'node:net';
import { after, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Réveil d'une instance : une connexion à la base morte pendant son sommeil ne doit plus faire
 * attendre personne.
 *
 * Constat du 11/10/2026 en production : un `select 1` resté 300 secondes sans réponse. Ces tests
 * verrouillent la parade — et le second la prouve avec le vrai pilote PostgreSQL, contre un
 * serveur qui accepte la connexion et ne répond jamais.
 */

describe('veille de la connexion', () => {
  /** Une veille pilotée à la main : l'horloge, la réponse de la base, et le compte des gestes. */
  async function veille(repond: () => Promise<boolean>) {
    const { createVigil } = await import('@server/db/vigil');
    const gestes = { sondes: 0, remplacements: 0 };
    let heure = 0;
    const vigil = createVigil({
      restMs: 15_000,
      probeMs: 50,
      now: () => heure,
      answers: () => {
        gestes.sondes += 1;
        return repond();
      },
      renew: () => {
        gestes.remplacements += 1;
      },
    });
    return { vigil, gestes, avancer: (ms: number) => (heure += ms) };
  }

  it('une instance qui vient de servir ne sonde pas ; après un repos, une seule sonde pour toutes les requêtes', async () => {
    const { vigil, gestes, avancer } = await veille(async () => true);
    await vigil.awake();
    assert.equal(gestes.sondes, 0, 'instance toute neuve : rien à vérifier');

    avancer(20_000);
    await Promise.all([vigil.awake(), vigil.awake(), vigil.awake()]);
    assert.deepEqual(gestes, { sondes: 1, remplacements: 0 }, 'la base répond : on garde la connexion');

    avancer(5_000);
    await vigil.awake();
    assert.equal(gestes.sondes, 1, 'vérifiée il y a cinq secondes : pas de nouvelle sonde');
  });

  it('une base muette au réveil : les connexions sont remplacées, une fois', async () => {
    const { vigil, gestes, avancer } = await veille(async () => false);
    avancer(60_000);
    await Promise.all([vigil.awake(), vigil.awake()]);
    assert.deepEqual(gestes, { sondes: 1, remplacements: 1 });
  });

  it('tant qu’une requête est en cours, on ne sonde pas : l’unique connexion peut être prise par un travail légitime', async () => {
    const { vigil, gestes, avancer } = await veille(async () => false);
    const fin = vigil.enter();
    avancer(120_000);
    await vigil.awake();
    assert.deepEqual(gestes, { sondes: 0, remplacements: 0 });

    fin();
    fin(); // « finish » puis « close » : la fin d'une requête ne se compte qu'une fois.
    avancer(1_000);
    await vigil.awake();
    assert.equal(gestes.sondes, 0, 'elle vient de finir : la connexion vient de servir');
    avancer(20_000);
    await vigil.awake();
    assert.deepEqual(gestes, { sondes: 1, remplacements: 1 });
  });

  it('une sonde qui échoue ne fait jamais échouer la requête', async () => {
    const { vigil, avancer } = await veille(() => Promise.reject(new Error('panne')));
    avancer(60_000);
    await vigil.awake();
  });
});

describe('le vrai pilote, contre une base qui ne répond plus', () => {
  const prises: Socket[] = [];
  /** Accepte la connexion et se tait : ce que voit une instance dont la connexion est morte en silence. */
  const muet = createServer((socket) => {
    prises.push(socket);
    socket.on('error', () => undefined);
  });

  after(async () => {
    for (const socket of prises) socket.destroy();
    await new Promise((resolve) => muet.close(resolve));
    await closeTestApp();
  });

  it('la requête pendue échoue dès le remplacement, au lieu d’attendre que l’hébergeur coupe', async () => {
    await createTestApp();
    const { closeDatabase, databaseAnswers, initDatabase, queryRows, renewDatabase } = await import('@server/db/client');
    await closeDatabase();
    await new Promise<void>((resolve) => muet.listen(0, '127.0.0.1', resolve));
    const port = (muet.address() as AddressInfo).port;
    await initDatabase(`postgresql://veille:veille@127.0.0.1:${port}/veille`, { migrate: false, maxConnections: 1 });

    // La requête d'un visiteur, partie dans le vide.
    const depart = Date.now();
    const pendue = queryRows(sql`select 1`).then(
      () => 'répondue',
      () => 'échouée',
    );
    assert.equal(await databaseAnswers(300), false, 'la sonde rend la main à son délai');
    assert.ok(Date.now() - depart < 2_000, 'sans attendre la base');

    renewDatabase();
    const sort = await Promise.race([pendue, new Promise((resolve) => setTimeout(() => resolve('toujours pendue'), 5_000))]);
    assert.equal(sort, 'échouée', 'la requête pendue est libérée');
    assert.ok(prises.length >= 1, 'le pilote s’était bien connecté au serveur muet');

    // La connexion neuve est une autre connexion : le serveur en voit arriver une de plus.
    const avant = prises.length;
    assert.equal(await databaseAnswers(300), false);
    assert.ok(prises.length > avant, 'une connexion neuve a été ouverte');
    renewDatabase();
    await closeDatabase();
  });
});
