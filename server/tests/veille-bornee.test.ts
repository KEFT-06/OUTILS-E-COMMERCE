import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Le passage de veille rend la main à l'heure.
 *
 * Constat du 12/10/2026, lu dans les comptes rendus publics de l'atelier : deux passages de suite
 * ont été relevés « le site n'a pas répondu » au bout de 280 s. Le passage n'avait pas de durée
 * bornée : une étape lente emportait toutes les suivantes, et l'atelier n'obtenait aucun compte
 * rendu. Ce qui est verrouillé ici : une étape qui ne répond pas ne retient pas le passage, une
 * étape qui échoue ne l'arrête pas, et un passage n'est relancé à la consultation que s'il est dû.
 */

const SECRET = 'secret-de-veille-de-test';
let app: Express;

before(async () => {
  app = await createTestApp({ CRON_SECRET: SECRET });
});

after(async () => {
  await closeTestApp();
});

describe('Passage de veille borné', () => {
  it('n’attend pas une étape qui ne répond pas, et le dit', async () => {
    const { boundedStep } = await import('@server/services/watch');
    const late: string[] = [];
    const started = Date.now();
    const hung = await boundedStep('index du marché', 120, () => new Promise<number>(() => undefined), late);
    assert.equal(hung, null);
    assert.ok(Date.now() - started < 1_000, 'la main est rendue à l’échéance, pas à la fin de l’étape');
    assert.deepEqual(late, ['index du marché']);

    // Une étape qui échoue ne coûte qu'elle-même, et n'est pas comptée en retard : son nom et son code sont notés, jamais son message.
    const failed: { etape: string; code: string | null }[] = [];
    assert.equal(await boundedStep('alertes', 500, () => Promise.reject(new Error('panne avec le nom d’une boutique')), late, failed), null);
    assert.equal(await boundedStep('état', 500, () => Promise.reject(Object.assign(new Error('colonne inconnue'), { code: '42703' })), late, failed), null);
    assert.deepEqual(failed, [{ etape: 'alertes', code: null }, { etape: 'état', code: '42703' }]);
    // Une étape qui aboutit rend son résultat, sans laisser de minuterie derrière elle.
    assert.equal(await boundedStep('surveillances', 500, () => Promise.resolve(7), late), 7);
    assert.deepEqual(late, ['index du marché']);
  });

  it('rend un compte rendu complet bien avant le délai de l’atelier', async () => {
    const started = Date.now();
    const passage = await request(app).get('/api/cron/veille').set('Authorization', `Bearer ${SECRET}`).expect(200);
    assert.ok(Date.now() - started < 30_000, 'sans rien à relever, le passage est immédiat');
    for (const key of ['surveillances', 'releves', 'alertes', 'etat', 'paiements', 'enRetard', 'enEchec', 'durees']) assert.ok(key in passage.body, `le compte rendu porte « ${key} »`);
    assert.deepEqual(
      Object.keys(passage.body.durees),
      ['reprise des rapports', 'paiements Mobile Money', 'surveillances', 'index du marché', 'alertes', 'compte rendu', 'état des ventes', 'état des publicités', 'état des alertes'],
      'chaque étape dit le temps qu’elle a pris',
    );
    assert.deepEqual(Object.keys(passage.body.etat).sort(), ['alertesAuFil', 'alertesDepuis24h', 'annonces', 'annoncesVuesDepuis24h', 'boutiques', 'boutiquesReleveesAujourdhui', 'derniereAnnonceVue', 'dernierReleveDeVentes'].sort());
    assert.deepEqual(passage.body.enRetard, [], 'aucune étape en retard');
    assert.deepEqual(passage.body.enEchec, [], 'aucune étape en échec');
    assert.ok(passage.body.etat && typeof passage.body.etat.annonces === 'number', 'l’état de la veille est lu');
    assert.equal(passage.body.paiements, 0, 'aucun paiement Mobile Money à reprendre');

    // Le passage laisse sa trace : c'est elle qui dit, ensuite, si un autre est dû.
    const { getDb } = await import('@server/db/client');
    const { auditLogs } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const { MARKET_RUN_AUDIT_ACTION } = await import('@server/services/market');
    const traces = await getDb().select().from(auditLogs).where(eq(auditLogs.action, MARKET_RUN_AUDIT_ACTION));
    assert.equal(traces.length, 1);
    assert.equal((traces[0]!.details as { source?: string }).source, 'veille continue');
  });

  it('ne relance un passage à la consultation que s’il est dû', async () => {
    const { WATCH_EVERY_MS, watchIsDue } = await import('@server/services/watch');
    const now = new Date('2026-10-12T12:00:00Z');
    assert.equal(watchIsDue(null, now), true, 'jamais passé : dû');
    assert.equal(watchIsDue(new Date(now.getTime() - WATCH_EVERY_MS - 1_000), now), true, 'plus d’une demi-heure : dû');
    assert.equal(watchIsDue(new Date(now.getTime() - 10 * 60_000), now), false, 'dix minutes : un autre passage n’apprendrait rien');
  });
});
