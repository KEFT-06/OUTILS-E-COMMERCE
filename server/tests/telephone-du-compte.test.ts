import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import request from 'supertest';
import { STRONG_PASSWORD, closeTestApp, createAdmin, createTestApp, signUp } from './support/helpers';

/**
 * Numéro de téléphone du compte, et graphe des utilisateurs de l'administration (demandes du
 * propriétaire, 11/10/2026 : « le numéro de téléphone de chaque utilisateur », « un graphe des
 * utilisateurs »).
 *
 * Le numéro est déclaré, pas vérifié : ce qui est verrouillé ici, c'est qu'il est enregistré dans
 * une seule écriture quelle que soit la façon de le taper, qu'une saisie illisible est refusée avec
 * un message qui dit quoi écrire, et que l'administration le retrouve par ses chiffres.
 */

let app: Express;

before(async () => {
  app = await createTestApp();
});

after(async () => {
  await closeTestApp();
});

const signupWith = (body: Record<string, unknown>) => request.agent(app).post('/api/auth/signup').send({ password: STRONG_PASSWORD, ...body });

describe('Numéro de téléphone du compte', () => {
  it('s’enregistre à l’inscription, au format international, quelle que soit la façon de le taper', async () => {
    const local = await signupWith({ name: 'Aïcha Douala', email: 'aicha-tel@exemple.com', country: 'CM', phone: '6 77 12 34 56' }).expect(201);
    assert.equal(local.body.account.phone, '+237677123456', 'numéro local : l’indicatif du pays est ajouté');

    const plus = await signupWith({ name: 'Brice Abidjan', email: 'brice-tel@exemple.com', country: 'CI', phone: '+225 07 08 09 10 11' }).expect(201);
    assert.equal(plus.body.account.phone, '+2250708091011', 'le zéro du numéro ivoirien est gardé');

    const zeros = await signupWith({ name: 'Carine Dakar', email: 'carine-tel@exemple.com', country: 'SN', phone: '00221 77 123 45 67' }).expect(201);
    assert.equal(zeros.body.account.phone, '+221771234567');

    // Sans pays, un numéro qui porte son indicatif est accepté tel quel.
    const sansPays = await signupWith({ name: 'Denis Ailleurs', email: 'denis-tel@exemple.com', phone: '+33 6 12 34 56 78' }).expect(201);
    assert.equal(sansPays.body.account.phone, '+33612345678');
  });

  it('refuse un numéro illisible en disant quoi écrire, et laisse s’inscrire sans numéro', async () => {
    const court = await signupWith({ name: 'Émile Court', email: 'emile-tel@exemple.com', country: 'CM', phone: '12 34' }).expect(400);
    assert.equal(court.body.error.code, 'PHONE_INVALID');
    assert.match(court.body.error.message, /\+237 suivi de votre numéro/, 'l’indicatif du pays choisi est donné en exemple');

    // Sans pays ni indicatif, on ne devine pas le pays de quelqu'un.
    const devine = await signupWith({ name: 'Fatou Sans', email: 'fatou-tel@exemple.com', phone: '677123456' }).expect(400);
    assert.equal(devine.body.error.code, 'PHONE_INVALID');
    assert.match(devine.body.error.message, /avec l’indicatif de votre pays/);

    // Le compte refusé n'a pas été créé : la même adresse peut s'inscrire ensuite.
    const repris = await signupWith({ name: 'Émile Court', email: 'emile-tel@exemple.com', country: 'CM' }).expect(201);
    assert.equal(repris.body.account.phone, null, 'les inscriptions sans numéro (comptes ouverts par un tiers, anciens écrans) restent possibles');
  });

  it('se corrige et se retire depuis « Mon compte », avec l’indicatif du pays du compte', async () => {
    const { agent } = await signUp(app, { name: 'Gaël Profil', email: 'gael-tel@exemple.com' });
    await agent.patch('/api/account/profile').send({ country: 'CM' }).expect(200);

    const saved = await agent.patch('/api/account/profile').send({ phone: '699 00 11 22' }).expect(200);
    assert.equal(saved.body.account.phone, '+237699001122');
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account.phone, '+237699001122');

    const refused = await agent.patch('/api/account/profile').send({ phone: 'pas un numéro' }).expect(400);
    assert.equal(refused.body.error.code, 'PHONE_INVALID');
    assert.equal((await agent.get('/api/auth/me').expect(200)).body.account.phone, '+237699001122', 'un refus ne touche pas au numéro en place');

    // Changer de pays et de numéro d'un même geste : l'indicatif est celui du nouveau pays.
    const moved = await agent.patch('/api/account/profile').send({ country: 'GA', phone: '06 03 04 05' }).expect(200);
    assert.equal(moved.body.account.phone, '+24106030405');

    // Le nom seul ne touche pas au numéro ; un champ vidé le retire.
    assert.equal((await agent.patch('/api/account/profile').send({ name: 'Gaël Renommé' }).expect(200)).body.account.phone, '+24106030405');
    assert.equal((await agent.patch('/api/account/profile').send({ phone: '' }).expect(200)).body.account.phone, null);

    // Le numéro fait partie des données que la personne peut emporter.
    await agent.patch('/api/account/profile').send({ phone: '+241 06 03 04 05' }).expect(200);
    const exported = await agent.get('/api/account/data-export').expect(200);
    assert.equal(exported.body.profile.phone, '+24106030405');
  });

  it('l’administration voit le numéro de chaque compte et le retrouve par ses chiffres', async () => {
    const admin = await createAdmin(app, 'admin-tel@smartcreator.test');
    await signupWith({ name: 'Hawa Cherchée', email: 'hawa-tel@exemple.com', country: 'CM', phone: '655 44 33 22' }).expect(201);

    const all = await admin.agent.get('/api/admin/users?pageSize=50').expect(200);
    const row = (all.body.users as { email: string; phone: string | null }[]).find((user) => user.email === 'hawa-tel@exemple.com');
    assert.equal(row?.phone, '+237655443322');
    assert.ok((all.body.users as { phone: string | null }[]).some((user) => user.phone === null), 'un compte sans numéro reste listé');

    const found = async (search: string) =>
      ((await admin.agent.get(`/api/admin/users?search=${encodeURIComponent(search)}`).expect(200)).body.users as { email: string }[]).map((user) => user.email);
    assert.deepEqual(await found('655 44 33 22'), ['hawa-tel@exemple.com'], 'tapé avec ses espaces');
    assert.deepEqual(await found('+237655443322'), ['hawa-tel@exemple.com'], 'tapé avec l’indicatif');
    assert.deepEqual(await found('4433'), ['hawa-tel@exemple.com'], 'par quelques chiffres');
    assert.deepEqual(await found('Hawa'), ['hawa-tel@exemple.com'], 'la recherche par nom marche toujours');

    const detail = await admin.agent.get(`/api/admin/users/${(all.body.users as { id: string; email: string }[]).find((user) => user.email === 'hawa-tel@exemple.com')!.id}`).expect(200);
    assert.equal(detail.body.user.phone, '+237655443322');
  });
});

describe('Graphe des utilisateurs', () => {
  it('compte les comptes ouverts par période et leur nombre à la fin de chacune', async () => {
    const admin = await createAdmin(app, 'admin-graphe@smartcreator.test');
    const overview = (await admin.agent.get('/api/admin/overview').expect(200)).body as { users: { total: number; newToday: number } };

    for (const [granularity, periods] of [['day', 30], ['month', 12], ['year', 5]] as const) {
      const { body } = await admin.agent.get(`/api/admin/series/users?granularity=${granularity}`).expect(200);
      const points = body.points as { period: string; signups: number; total: number }[];
      assert.equal(points.length, periods, `${granularity} : une valeur par période`);
      assert.equal(points.at(-1)!.total, overview.users.total, 'le dernier point est le nombre de comptes de la vue d’ensemble');
      assert.equal(body.signups, points.reduce((sum, point) => sum + point.signups, 0));
      assert.ok(points.every((point, index) => index === 0 || point.total >= points[index - 1]!.total), 'le nombre de comptes ne recule jamais');
      assert.ok(points.every((point, index) => index === 0 || point.total - points[index - 1]!.total === point.signups), 'chaque période ajoute exactement ses nouveaux comptes');
    }

    // Tous les comptes de cette base viennent d'être créés : ils sont tous d'aujourd'hui.
    const today = (await admin.agent.get('/api/admin/series/users?granularity=day').expect(200)).body.points.at(-1) as { signups: number };
    assert.equal(today.signups, overview.users.newToday);

    // Un compte de plus : le graphe et la vue d'ensemble bougent ensemble.
    await signupWith({ name: 'Inès Nouvelle', email: 'ines-graphe@exemple.com', country: 'CM' }).expect(201);
    const after = (await admin.agent.get('/api/admin/series/users?granularity=day').expect(200)).body.points.at(-1) as { signups: number; total: number };
    assert.equal(after.total, overview.users.total + 1);
    assert.equal(after.signups, today.signups + 1);
  });

  it('est réservé à l’équipe', async () => {
    const { agent } = await signUp(app, { name: 'Simple Membre', email: 'membre-graphe@exemple.com' });
    await agent.get('/api/admin/series/users').expect(403);
    await request(app).get('/api/admin/series/users').expect(401);
  });
});

describe('Indicatifs et lecture d’un numéro', () => {
  it('connaît l’indicatif des pays du site', async () => {
    const { dialCodeOf } = await import('@server/shared/dialCodes');
    const { COUNTRIES } = await import('@server/shared/countries');
    for (const [country, dial] of [['CM', '237'], ['CI', '225'], ['SN', '221'], ['BJ', '229'], ['TG', '228'], ['GA', '241'], ['CD', '243'], ['CG', '242'], ['ML', '223'], ['BF', '226'], ['FR', '33'], ['BE', '32'], ['CA', '1'], ['MA', '212']]) {
      assert.equal(dialCodeOf(country), dial, country);
    }
    assert.equal(dialCodeOf('cm'), '237', 'la casse ne compte pas');
    assert.equal(dialCodeOf(null), '');
    assert.equal(dialCodeOf('ZZ'), '');
    // Tout pays que le site propose et qui a un indicatif attribué en reçoit un : seuls des territoires sans numérotation propre en sont dépourvus.
    const sans = COUNTRIES.filter((country) => !dialCodeOf(country.code)).map((country) => country.code);
    assert.ok(sans.length <= 8, `pays sans indicatif : ${sans.join(', ')}`);
  });

  it('écrit et relit un numéro de compte', async () => {
    const { accountPhone, formatPhone } = await import('@server/shared/phone');
    assert.equal(accountPhone('677123456', 'CM'), '+237677123456');
    assert.equal(accountPhone('237677123456', 'CM'), '+237677123456', 'indicatif déjà écrit, sans le « + »');
    assert.equal(accountPhone('677123456', null), null);
    assert.equal(accountPhone('+237 677 12 34 56', null), '+237677123456');
    assert.equal(accountPhone('abc', 'CM'), null);

    assert.equal(formatPhone('+237677123456', 'CM'), '+237 677 12 34 56');
    assert.equal(formatPhone('+2250708091011', 'CI'), '+225 07 08 09 10 11');
    assert.equal(formatPhone('+33612345678', null), '+336 12 34 56 78', 'sans pays connu : groupes de chiffres, rien n’est perdu');
    assert.equal(formatPhone(null, 'CM'), '');
  });
});
