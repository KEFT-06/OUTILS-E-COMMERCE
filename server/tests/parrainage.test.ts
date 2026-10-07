import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { signInWithPlan } from './support/analysis-fixtures';
import { STRONG_PASSWORD, closeTestApp, createAdmin, createTestApp } from './support/helpers';

/**
 * Parrainage, de bout en bout : le lien, le suivi, le rattachement à l'inscription, la commission
 * sur le paiement, le délai de garde, le retrait et son règlement par l'équipe.
 *
 * Ce que ces tests verrouillent, c'est l'argent : une commission ne naît que d'un PAIEMENT, une
 * seule fois par paiement ; un remboursement la fait tomber ; un solde ne se retire pas deux fois.
 */

let app: Express;
let admin: Awaited<ReturnType<typeof createAdmin>>;

before(async () => {
  // Conditions fixées pour le test : 20 %, 14 jours de garde, retrait à partir de 5 000 FCFA.
  app = await createTestApp({ REFERRAL_COMMISSION_PERCENT: '20', REFERRAL_HOLD_DAYS: '14', REFERRAL_MIN_PAYOUT_FCFA: '5000' });
  admin = await createAdmin(app, 'admin-parrainage@smartcreator.test');
});

after(async () => {
  await closeTestApp();
});

const cookieDe = (response: request.Response, nom: string) =>
  ((response.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((cookie) => cookie.startsWith(`${nom}=`)) ?? null;

describe('Parrainage', () => {
  let parrain: Awaited<ReturnType<typeof signInWithPlan>>;
  let code = '';
  let filleulId = '';

  it('donne à chaque compte un lien, compte ses visites une fois par navigateur, et ignore un code inconnu', async () => {
    parrain = await signInWithPlan(app, 'parrain@exemple.test', 'pro');
    const tableau = await parrain.agent.get('/api/referral').expect(200);
    code = tableau.body.code as string;
    assert.match(code, /^[A-Z2-9]{8}$/, 'un code qui se dicte : ni 0, ni O, ni 1, ni I');
    assert.ok((tableau.body.link as string).endsWith(`/r/${code}`));
    assert.ok((tableau.body.altLink as string).endsWith(`/?ref=${code}`));
    assert.deepEqual(tableau.body.terms, { mode: 'percent', percent: 20, fixedFcfa: 0, holdDays: 14, minPayoutFcfa: 5000, cookieDays: 30 });
    assert.equal((await parrain.agent.get('/api/referral').expect(200)).body.code, code, 'le code ne change pas d’une visite à l’autre');

    // La visite est comptée, mais RIEN n'est déposé : ce cookie ne sert pas au visiteur, il demande son accord.
    const visiteur = request.agent(app);
    const visite = await visiteur.post('/api/referral/visit').send({ code: code.toLowerCase() }).expect(200);
    assert.equal(visite.body.followed, true);
    assert.equal(cookieDe(visite, 'sc_ref'), null, 'aucun cookie sans accord');
    assert.equal((await parrain.agent.get('/api/referral').expect(200)).body.clicks, 1);

    // Le visiteur accepte qu'on retienne le parrainage : le cookie est posé, la visite n'est pas recomptée.
    const accord = await visiteur.post('/api/referral/visit').send({ code, remember: true }).expect(200);
    const cookie = cookieDe(accord, 'sc_ref');
    assert.ok(cookie, 'le lien suivi est gardé dans un cookie');
    assert.match(cookie, /HttpOnly/i, 'illisible par la page');
    assert.match(cookie, /Max-Age=2592000/, 'trente jours');
    // Le même navigateur revient par le même lien : toujours une seule visite comptée.
    await visiteur.post('/api/referral/visit').send({ code }).expect(200);
    assert.equal((await parrain.agent.get('/api/referral').expect(200)).body.clicks, 1);

    const inconnu = await request(app).post('/api/referral/visit').send({ code: 'ZZZZ2222' }).expect(200);
    assert.equal(inconnu.body.followed, false);
    assert.equal(cookieDe(inconnu, 'sc_ref'), null, 'un code inconnu ne pose rien');
  });

  it('rattache le compte créé au parrain du dernier lien suivi, une fois pour toutes', async () => {
    const autre = await signInWithPlan(app, 'autre-parrain@exemple.test', 'pro');
    const codeAutre = (await autre.agent.get('/api/referral').expect(200)).body.code as string;

    // Le visiteur suit d'abord le lien d'un autre parrain, puis celui du nôtre : dernier clic.
    const visiteur = request.agent(app);
    await visiteur.post('/api/referral/visit').send({ code: codeAutre, remember: true }).expect(200);
    await visiteur.post('/api/referral/visit').send({ code, remember: true }).expect(200);
    const inscription = await visiteur.post('/api/auth/signup').send({ name: 'Awa Kamga', email: 'filleule@exemple.test', password: STRONG_PASSWORD }).expect(201);
    filleulId = inscription.body.account.id as string;
    assert.match(String(cookieDe(inscription, 'sc_ref')), /sc_ref=;/, 'le cookie a servi : il est effacé');

    const tableau = await parrain.agent.get('/api/referral').expect(200);
    assert.equal(tableau.body.signups, 1);
    assert.equal(tableau.body.customers, 0, 'inscrite, pas encore cliente');
    assert.deepEqual(tableau.body.balances, { pending: 0, available: 0, requested: 0, paid: 0 }, 'une inscription seule ne rapporte rien');
    assert.equal((await autre.agent.get('/api/referral').expect(200)).body.signups, 0, 'dernier clic : le premier lien ne compte plus');

    // Sans accord pour le cookie : s'inscrire pendant la même visite rattache quand même le compte,
    // le code voyageant avec la demande. Un code inventé, lui, ne rattache rien.
    const sansCookie = await request(app).post('/api/auth/signup').send({ name: 'Moussa Diallo', email: 'filleul-visite@exemple.test', password: STRONG_PASSWORD, ref: codeAutre }).expect(201);
    assert.ok(sansCookie.body.account.id);
    assert.equal((await autre.agent.get('/api/referral').expect(200)).body.signups, 1, 'rattaché par le code de la visite');
    await request(app).post('/api/auth/signup').send({ name: 'Sans Parrain', email: 'sans-parrain@exemple.test', password: STRONG_PASSWORD, ref: 'ZZZZ2222' }).expect(201);
    assert.equal((await autre.agent.get('/api/referral').expect(200)).body.signups, 1);

    // Ni changement de parrain, ni parrainage de soi-même.
    const { attachReferral } = await import('@server/services/referral');
    assert.equal(await attachReferral(filleulId, codeAutre), false, 'un compte ne change pas de parrain');
    assert.equal(await attachReferral(parrain.userId, code), false, 'on ne se parraine pas soi-même');
  });

  it('crée une commission par paiement du filleul, la valide après le délai de garde, et la fait tomber si le paiement est remboursé', async () => {
    const paiement = (montant: number, reference: string) =>
      admin.agent.post('/api/admin/payments').send({ userId: filleulId, plan: 'plus', periodMonths: 1, amount: montant, currency: 'XAF', method: 'mobile_money', reference });
    const premier = await paiement(10_000, 'OM-PARRAIN-1').expect(201);
    const second = await paiement(30_000, 'OM-PARRAIN-2').expect(201);

    let tableau = await parrain.agent.get('/api/referral').expect(200);
    assert.equal(tableau.body.customers, 1);
    assert.equal(tableau.body.balances.pending, 8_000, '20 % de 10 000 + 20 % de 30 000, en attente');
    assert.equal(tableau.body.balances.available, 0, 'rien n’est retirable avant le délai de garde');
    assert.equal(tableau.body.commissions.length, 2);
    assert.equal(tableau.body.commissions[0].referred, 'Awa K.', 'le filleul est reconnaissable, pas identifiable');

    // Le même paiement ne crée jamais deux commissions.
    const { recordReferralCommission, settleDueCommissions } = await import('@server/services/referral');
    assert.equal(await recordReferralCommission({ paymentId: premier.body.payment.id, userId: filleulId, amountFcfa: 10_000 }), false);

    // Avant la fin du délai : rien ne bouge.
    assert.deepEqual(await settleDueCommissions(new Date(Date.now() + 13 * 86_400_000)), { approved: 0, cancelled: 0 });

    // Le second paiement est remboursé pendant le délai de garde : sa commission tombe.
    await admin.agent.post(`/api/admin/payments/${second.body.payment.id}/refund`).send({ note: 'Demande du client' }).expect(200);
    assert.deepEqual(await settleDueCommissions(new Date(Date.now() + 15 * 86_400_000)), { approved: 1, cancelled: 0 });

    tableau = await parrain.agent.get('/api/referral').expect(200);
    assert.deepEqual(tableau.body.balances, { pending: 0, available: 2_000, requested: 0, paid: 0 });
    assert.deepEqual(
      (tableau.body.commissions as { status: string; amountFcfa: number }[]).map((commission) => `${commission.status}:${commission.amountFcfa}`).sort(),
      ['approved:2000', 'cancelled:6000'],
    );
  });

  it('ne laisse retirer qu’un solde validé qui atteint le minimum, une demande à la fois, et solde les commissions une fois le versement fait', async () => {
    const demande = { method: 'orange_money', destination: '+237 6 99 00 11 22', holderName: 'Parrain Test' };
    const tropTot = await parrain.agent.post('/api/referral/payouts').send(demande).expect(409);
    assert.equal(tropTot.body.error.code, 'REFERRAL_BELOW_MINIMUM', '2 000 FCFA validés, 5 000 demandés');

    // Un troisième paiement du filleul, validé à son tour : le solde passe le minimum.
    await admin.agent.post('/api/admin/payments').send({ userId: filleulId, plan: 'pro', periodMonths: 1, amount: 20_000, currency: 'XAF', method: 'mobile_money', reference: 'OM-PARRAIN-3' }).expect(201);
    const { settleDueCommissions } = await import('@server/services/referral');
    await settleDueCommissions(new Date(Date.now() + 15 * 86_400_000));

    const acceptee = await parrain.agent.post('/api/referral/payouts').send(demande).expect(201);
    assert.equal(acceptee.body.amountFcfa, 6_000, 'tout le solde validé part dans la demande');
    const double = await parrain.agent.post('/api/referral/payouts').send(demande).expect(409);
    assert.equal(double.body.error.code, 'REFERRAL_PAYOUT_PENDING');

    let tableau = await parrain.agent.get('/api/referral').expect(200);
    assert.deepEqual(tableau.body.balances, { pending: 0, available: 0, requested: 6_000, paid: 0 });
    assert.equal(tableau.body.payouts[0].destination, '••••••••1 22', 'le numéro n’est pas réaffiché en entier');

    // L'équipe : elle voit la demande avec ses coordonnées complètes, la règle, et ne la règle qu'une fois.
    await parrain.agent.get('/api/admin/referral/payouts').expect(403);
    const file = await admin.agent.get('/api/admin/referral/payouts?status=requested').expect(200);
    assert.equal(file.body.payouts.length, 1);
    assert.equal(file.body.payouts[0].destination, '+237 6 99 00 11 22');
    assert.equal(file.body.payouts[0].affiliate.email, 'parrain@exemple.test');
    await admin.agent.post(`/api/admin/referral/payouts/${acceptee.body.id}`).send({ decision: 'paid', note: 'OM 0915-7781' }).expect(204);
    await admin.agent.post(`/api/admin/referral/payouts/${acceptee.body.id}`).send({ decision: 'paid' }).expect(409);

    tableau = await parrain.agent.get('/api/referral').expect(200);
    assert.deepEqual(tableau.body.balances, { pending: 0, available: 0, requested: 0, paid: 6_000 });
    assert.equal(tableau.body.payouts[0].status, 'paid');
    assert.equal(tableau.body.payouts[0].note, 'OM 0915-7781');

    // Un remboursement après versement ne reprend pas ce qui a été payé.
    const { cancelCommissionOf } = await import('@server/services/referral');
    const { getDb } = await import('@server/db/client');
    const { referralCommissions } = await import('@server/db/schema');
    const { eq } = await import('drizzle-orm');
    const [payee] = await getDb().select().from(referralCommissions).where(eq(referralCommissions.status, 'paid')).limit(1);
    await cancelCommissionOf(payee!.paymentId);
    assert.equal((await parrain.agent.get('/api/referral').expect(200)).body.balances.paid, 6_000);
  });

  it('rend le solde disponible quand l’équipe refuse une demande, et applique un montant fixe quand il est réglé', async () => {
    const { requestPayout, processPayout, recordReferralCommission, settleDueCommissions, commissionFor } = await import('@server/services/referral');
    const { getDb } = await import('@server/db/client');
    const { payments } = await import('@server/db/schema');
    const [paiement] = await getDb()
      .insert(payments)
      .values({ userId: filleulId, userEmail: 'filleule@exemple.test', plan: 'pro', periodMonths: 1, currency: 'XAF', amountMinor: 50_000, amountFcfa: 50_000, method: 'mobile_money', paidAt: new Date() })
      .returning();
    assert.equal(await recordReferralCommission({ paymentId: paiement!.id, userId: filleulId, amountFcfa: 50_000 }), true);
    await settleDueCommissions(new Date(Date.now() + 15 * 86_400_000));

    const demande = await requestPayout(parrain.userId, { method: 'bank', destination: 'CM21 1000 2000 3000 4000 5000 600', holderName: 'Parrain Test' });
    assert.equal(demande.amountFcfa, 10_000);
    await processPayout(demande.id, 'rejected', admin.user.id, 'IBAN illisible');
    const tableau = await parrain.agent.get('/api/referral').expect(200);
    assert.equal(tableau.body.balances.available, 10_000, 'le solde est de nouveau retirable');
    assert.equal(tableau.body.payouts[0].status, 'rejected');
    assert.equal(tableau.body.payouts[0].note, 'IBAN illisible');

    // Pourcentage par défaut : 20 % ; le calcul arrondit au franc.
    assert.equal(commissionFor(12_345), 2_469);
  });
});
