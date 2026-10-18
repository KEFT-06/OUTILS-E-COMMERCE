import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Les alertes tirées du mur publicitaire seul : elles tiennent le fil vivant quand les ventes d'une
 * boutique ne se relèvent pas.
 *
 * Demande du propriétaire, 11/10/2026 : « je ne veux pas "aucune alerte pour l'instant", qui est
 * vrai mais trompeur ; je veux que ça tourne en continu ». Constat du même jour : la plateforme
 * des vitrines ne répondait plus au serveur, donc plus aucune règle de ventes ne pouvait se
 * déclencher. Les publicités, elles, sont publiques et relevées plusieurs fois par jour.
 */

const JOUR = 86_400_000;
const HEURE = 3_600_000;
const now = new Date('2026-10-11T12:00:00Z');
const ilYA = (ms: number) => new Date(now.getTime() - ms);

let app: Express;

/** Une annonce du mur, vue à l'instant sauf indication contraire. */
const annonce = (externalId: string, storeHost: string, startedAt: Date, autres: Record<string, unknown> = {}) => ({
  externalId,
  storeHost,
  landingUrl: `https://${storeHost}/prd_${externalId}`,
  title: `Offre ${externalId}`,
  advertiser: `Boutique ${storeHost.split('.')[0]}`,
  startedAt,
  active: true,
  lastSeenAt: now,
  ...autres,
});

before(async () => {
  app = await createTestApp();
});

after(closeTestApp);

describe('Alertes — une publicité qui dure', () => {
  it('signale le cap de 30, 60 ou 90 jours d’une annonce encore active et vue récemment, une seule fois', async () => {
    const { getDb } = await import('@server/db/client');
    const { spiedAds } = await import('@server/db/schema');
    const { detectNewAlerts } = await import('@server/services/alerts');
    await getDb()
      .insert(spiedAds)
      .values([
        annonce('cap-60', 'durable.mychariow.com', ilYA(60 * JOUR + 2 * HEURE), { title: 'Formation couture en 30 jours', variants: 3 }),
        annonce('cap-30', 'recente.mymaketou.shop', ilYA(30 * JOUR + 5 * HEURE)),
        annonce('cap-90', 'installee.myshopify.com', ilYA(90 * JOUR + 20 * HEURE)),
        // Entre deux caps : rien à dire aujourd'hui.
        annonce('entre-caps', 'milieu.mychariow.com', ilYA(45 * JOUR)),
        // Au cap, mais plus vue depuis cinq jours : le mur n'a pas été relevé, on ne sait pas si elle tourne encore.
        annonce('pas-vue', 'oubliee.mychariow.com', ilYA(60 * JOUR + HEURE), { lastSeenAt: ilYA(5 * JOUR) }),
        // Au cap, mais arrêtée.
        annonce('arretee', 'finie.mychariow.com', ilYA(60 * JOUR + HEURE), { active: false, stoppedAt: ilYA(HEURE) }),
      ]);

    const alertes = (await detectNewAlerts(now)).filter((alerte) => alerte.kind === 'ad_longevity');
    assert.deepEqual(
      alertes.map((alerte) => [alerte.payload.days, alerte.level, alerte.payload.storeHost]).sort(),
      [
        [30, 'info', 'recente.mymaketou.shop'],
        [60, 'opportunity', 'durable.mychariow.com'],
        [90, 'opportunity', 'installee.myshopify.com'],
      ],
    );
    const deuxMois = alertes.find((alerte) => alerte.payload.days === 60)!;
    assert.equal(deuxMois.title, 'Publicité qui dure');
    assert.match(deuxMois.body, /^Boutique durable diffuse la même publicité depuis 60 jours, en 3 versions : « Formation couture en 30 jours »\./);

    // Le passage suivant, une demi-heure plus tard, ne répète rien.
    assert.equal((await detectNewAlerts(new Date(now.getTime() + 30 * 60_000))).filter((alerte) => alerte.kind === 'ad_longevity').length, 0);
  });

  /*
    Relevé le 18/10/2026 : cinq fois « Africa boost diffuse la même publicité depuis 30 jours » au fil
    — la même annonce, publiée en plusieurs copies par l'annonceur.
  */
  it('ne répète pas l’alerte pour les copies d’une même annonce, ni au passage suivant', async () => {
    const { getDb } = await import('@server/db/client');
    const { spiedAds } = await import('@server/db/schema');
    const { detectNewAlerts } = await import('@server/services/alerts');
    const jour = new Date(now.getTime() + 3 * JOUR);
    const depart = new Date(jour.getTime() - 30 * JOUR - 2 * HEURE);
    await getDb()
      .insert(spiedAds)
      .values([
        annonce('copie-1', 'copies.mychariow.com', depart, { title: '+1500 Clients satisfaits', variants: 2, lastSeenAt: jour }),
        annonce('copie-2', 'copies.mychariow.com', depart, { title: '+1500  clients satisfaits', variants: 2, lastSeenAt: jour }),
        annonce('copie-autre-titre', 'copies.mychariow.com', depart, { title: '+2500 Clients satisfaits', lastSeenAt: jour }),
      ]);
    const deLaBoutique = async (date: Date) => (await detectNewAlerts(date)).filter((alerte) => alerte.kind === 'ad_longevity' && alerte.payload.storeHost === 'copies.mychariow.com');
    const alertes = await deLaBoutique(jour);
    assert.deepEqual(alertes.map((alerte) => alerte.payload.title).sort(), ['+1500 Clients satisfaits', '+2500 Clients satisfaits'], 'une alerte par annonce, pas par copie');
    assert.equal((await deLaBoutique(new Date(jour.getTime() + HEURE))).length, 0, 'la copie restée de côté ne revient pas au passage suivant');
  });

  it('ne dresse pas l’inventaire : au plus six annonces par cap, celles aux plus nombreuses versions', async () => {
    const { getDb } = await import('@server/db/client');
    const { spiedAds } = await import('@server/db/schema');
    const { detectNewAlerts } = await import('@server/services/alerts');
    const demain = new Date(now.getTime() + JOUR);
    await getDb()
      .insert(spiedAds)
      .values(Array.from({ length: 9 }, (_, rang) => annonce(`foule-${rang}`, `foule-${rang}.mychariow.com`, new Date(demain.getTime() - 60 * JOUR - HEURE), { variants: rang + 1, lastSeenAt: demain })));
    const alertes = (await detectNewAlerts(demain)).filter((alerte) => alerte.kind === 'ad_longevity' && String(alerte.payload.storeHost).startsWith('foule-'));
    assert.equal(alertes.length, 6);
    assert.deepEqual(alertes.map((alerte) => alerte.payload.storeHost).sort(), ['foule-3', 'foule-4', 'foule-5', 'foule-6', 'foule-7', 'foule-8'].map((nom) => `${nom}.mychariow.com`));
  });
});

describe('Alertes — une boutique qui monte en puissance', () => {
  it('signale quatre publicités nouvelles en trois jours, une fois par semaine, et se tait en dessous', async () => {
    const { getDb } = await import('@server/db/client');
    const { spiedAds } = await import('@server/db/schema');
    const { detectNewAlerts } = await import('@server/services/alerts');
    const jour = new Date('2026-11-02T09:00:00Z');
    const avant = (ms: number) => new Date(jour.getTime() - ms);
    await getDb()
      .insert(spiedAds)
      .values([
        // Quatre lancées en trois jours, deux déjà installées.
        ...[4, 20, 40, 60].map((heures, rang) => annonce(`elan-${rang}`, 'elan.mychariow.com', avant(heures * HEURE), { lastSeenAt: jour })),
        ...[10, 25].map((jours, rang) => annonce(`elan-fond-${rang}`, 'elan.mychariow.com', avant(jours * JOUR), { lastSeenAt: jour })),
        // Trois seulement : un essai, pas un élan.
        ...[5, 30, 50].map((heures, rang) => annonce(`essai-${rang}`, 'essai.mymaketou.shop', avant(heures * HEURE), { lastSeenAt: jour })),
      ]);

    const alertes = (await detectNewAlerts(jour)).filter((alerte) => alerte.kind === 'store_ramp');
    assert.equal(alertes.length, 1);
    assert.deepEqual([alertes[0]!.level, alertes[0]!.payload.storeHost, alertes[0]!.payload.newAds, alertes[0]!.payload.runningAds], ['opportunity', 'elan.mychariow.com', 4, 2]);
    assert.match(alertes[0]!.body, /^Boutique elan a lancé 4 publicités nouvelles en trois jours, en plus de 2 déjà en cours\./);
    assert.equal((await detectNewAlerts(new Date(jour.getTime() + 4 * HEURE))).filter((alerte) => alerte.kind === 'store_ramp').length, 0, 'le même élan ne se signale pas à chaque passage');
  });
});

describe('Alertes — ce que le fil et le compte rendu en disent', () => {
  it('le fil rend ces alertes à tout compte, et l’état de la veille compte ce qui a été vu', async () => {
    const { watchState } = await import('@server/services/alerts');
    const { agent } = await signInWithPlan(app, 'fil-publicites@exemple.test', 'free');
    const fil = (await agent.get('/api/alerts').expect(200)).body as { alerts: { kind: string; title: string; body: string }[] };
    const genres = new Set(fil.alerts.map((alerte) => alerte.kind));
    assert.ok(genres.has('ad_longevity') && genres.has('store_ramp'), `genres au fil : ${[...genres].join(', ')}`);
    assert.ok(fil.alerts.every((alerte) => alerte.title && alerte.body), 'chaque alerte a son titre et sa phrase');

    const etat = await watchState(new Date('2026-11-02T10:00:00Z'));
    assert.equal(etat.alertesAuFil, fil.alerts.length);
    assert.ok(etat.annonces >= 24 && etat.annoncesVuesDepuis24h >= 9, `mur : ${etat.annonces} annonces, ${etat.annoncesVuesDepuis24h} vues en 24 h`);
    assert.equal(etat.derniereAnnonceVue, '2026-11-02T09:00:00.000Z');
    // Aucune boutique n'a de ventes relevées dans ce test : l'état le dit, sans rien inventer.
    assert.deepEqual([etat.boutiques, etat.boutiquesReleveesAujourdhui, etat.dernierReleveDeVentes], [0, 0, null]);
  });
});

describe('Correction 0053 — alertes en double', () => {
  it('garde la plus ancienne alerte par annonceur, titre et cap, et rien d’autre ne bouge', async () => {
    const { readFileSync } = await import('node:fs');
    const { sql, like } = await import('drizzle-orm');
    const { getDb } = await import('@server/db/client');
    const { alerts } = await import('@server/db/schema');
    const t = (minutes: number) => new Date(Date.UTC(2026, 9, 18, 10, minutes));
    const alerte = (cle: string, storeHost: string, title: string | null, days: number, minutes: number) => ({
      kind: 'ad_longevity' as const,
      level: 'info' as const,
      title: 'Publicité qui dure',
      body: `${storeHost} depuis ${days} jours`,
      payload: { storeHost, title, days },
      dedupeKey: `correction-0053:${cle}`,
      occurredAt: t(minutes),
    });
    await getDb()
      .insert(alerts)
      .values([
        alerte('a1', 'doublons.mychariow.com', '+1500 Clients satisfaits', 30, 1),
        alerte('a2', 'doublons.mychariow.com', '+1500  clients satisfaits', 30, 2),
        alerte('a3', 'doublons.mychariow.com', '+1500 Clients satisfaits', 30, 3),
        alerte('b1', 'doublons.mychariow.com', '+2500 Clients satisfaits', 30, 4),
        alerte('c1', 'doublons.mychariow.com', '+1500 Clients satisfaits', 60, 5),
        alerte('d1', 'doublons.mychariow.com', null, 30, 6),
        alerte('d2', 'doublons.mychariow.com', null, 30, 7),
      ]);

    await getDb().execute(sql.raw(readFileSync('server/db/migrations/0053_alertes_publicite_en_double.sql', 'utf8')));

    const restantes = (await getDb().select({ cle: alerts.dedupeKey }).from(alerts).where(like(alerts.dedupeKey, 'correction-0053:%'))).map((row) => row.cle.slice(16)).sort();
    assert.deepEqual(restantes, ['a1', 'b1', 'c1', 'd1', 'd2']);
  });
});
