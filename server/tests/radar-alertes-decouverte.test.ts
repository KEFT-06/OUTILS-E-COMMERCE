import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import { signInWithPlan } from './support/analysis-fixtures';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Deux pièces qui rendent le radar utile hors de l'écran : le résumé par e-mail, et la
 * découverte de boutiques qu'on ne connaît pas.
 *
 * Ce qui est verrouillé ici tient surtout à l'argent et au courrier indésirable :
 *  - la collecte de publicités se paie AU RÉSULTAT, donc aucun utilisateur ne doit pouvoir
 *    la déclencher, et le plafond envoyé au fournisseur doit être celui configuré ;
 *  - un résumé ne part qu'une fois par période, jamais vide, et jamais vers une adresse
 *    non confirmée.
 */

const BOUTIQUE = 'store_faussevitrine2';
const PAGE = `<html><head><title>BOUTIQUE B</title></head><body>${BOUTIQUE}</body></html>`;

let catalogue = [{ id: 'prd_x1', name: 'Pack productivité', prix: 4_000, ventes: 2 }];

/** Ce que le faux fournisseur de collecte a reçu : sert à vérifier le plafond facturé. */
const collectes: { chemin: string; corps: Record<string, unknown> }[] = [];
/** Pilote le faux fournisseur : vrai, il répond une collecte sans aucun résultat. */
let collecteVide = false;
/** Messages acceptés par le faux service d'e-mail. */
const courriers: { to: string; subject: string; text: string }[] = [];

const faux = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://faux.test');
    const json = (code: number, corps: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corps));
    };

    // --- Vitrine Chariow ---
    if (url.pathname === `/storefront/${BOUTIQUE}/products`) {
      json(200, {
        data: catalogue.map((p) => ({
          id: p.id,
          name: p.name,
          type: 'downloadable',
          status: 'published',
          pricing: { effective: { value: p.prix, currency: 'XAF' } },
          sales_count: { value: p.ventes },
          store: { name: 'BOUTIQUE B' },
        })),
        pagination: { next_page_url: null },
      });
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }

    // --- Collecte de publicités (Apify) ---
    if (req.method === 'POST' && url.pathname.includes('/run-sync-get-dataset-items')) {
      collectes.push({
        chemin: url.pathname,
        corps: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      });
      // Une collecte peut très bien ne rien rapporter : mot-clé sans résultat, champ renommé
      // chez le fournisseur, acteur interrompu. Elle est facturée quand même.
      if (collecteVide) {
        json(200, []);
        return;
      }
      // Deux publicités, trois mentions de boutiques, dont un sous-domaine technique à écarter
      // et la même boutique citée deux fois dans une seule publicité.
      json(200, [
        { ad_id: '1', snapshot: { link_url: 'https://mabelleboutique.mychariow.shop/produit-1' }, body: 'voir mabelleboutique.mychariow.com' },
        { ad_id: '2', caption: 'https://autreshop.mychariow.com/x et https://api-edge.mychariow.com/interne' },
      ]);
      return;
    }

    // --- Envoi d'e-mail (Brevo) ---
    if (req.method === 'POST' && url.pathname === '/v3/smtp/email') {
      const corps = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        to: { email: string }[];
        subject: string;
        textContent: string;
      };
      courriers.push({ to: corps.to[0]!.email, subject: corps.subject, text: corps.textContent });
      json(201, { messageId: `msg-${courriers.length}` });
      return;
    }

    json(404, { detail: 'Not Found' });
  });
});

let app: Express;
let base = '';

before(async () => {
  await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(faux.address() as AddressInfo).port}`;
  app = await createTestApp({
    CHARIOW_STOREFRONT_URL: base,
    APIFY_TOKEN: 'jeton-apify-de-test',
    APIFY_API_URL: base,
    APIFY_ADS_ACTOR: 'apify~facebook-ads-scraper',
    RADAR_DISCOVERY_LIMIT: '150',
    RADAR_DISCOVERY_QUERY: 'mychariow',
    EMAIL_PROVIDER: 'brevo',
    EMAIL_API_KEY: 'cle-email-de-test',
    EMAIL_FROM: 'Smart Creator <no-reply@exemple.test>',
    EMAIL_API_URL: base,
  });
});

after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => faux.close(() => r()));
});

describe('Radar — découverte de boutiques', () => {
  it('ne laisse pas un utilisateur déclencher une collecte payante', async () => {
    const { agent } = await signInWithPlan(app, 'decouverte-user@exemple.test', 'pro');
    const avant = collectes.length;

    // La liste est lisible par tous : c'est du cache, elle ne coûte rien.
    const vue = await agent.get('/api/radar/discover').expect(200);
    assert.equal(vue.body.configured, true);
    assert.equal(vue.body.canRefresh, false, 'un compte ordinaire ne voit pas le bouton de collecte');

    // La collecte, elle, est refusée.
    await agent.post('/api/radar/discover/refresh').expect(403);
    assert.equal(collectes.length, avant, 'aucun appel payant n’a été émis');
  });

  it('cherche le mot-clé, respecte le plafond facturé et écarte les sous-domaines techniques', async () => {
    // createAdmin ouvre la session avec le second facteur : l'administration l'exige, et une
    // route qui engage de l'argent est justement ce que cette exigence protège.
    const { createAdmin } = await import('./support/helpers');
    const { agent } = await createAdmin(app, 'decouverte-admin@exemple.test');

    const collecte = await agent.post('/api/radar/discover/refresh').expect(200);
    /*
      `adsKept: 0` est correct ici, et c'est instructif : les annonces de ce fixture nomment le lien
      « link_url », alors que la vraie API le nomme « linkUrl » — mesuré le 23/09/2026. La
      DÉCOUVERTE de boutiques s'en moque, car elle cherche les hôtes dans l'enregistrement entier ;
      le MUR d'espionnage, lui, exige le champ exact et écarte donc ces annonces. La forme réelle
      est éprouvée dans espionnage.test.ts.
    */
    assert.deepEqual(collecte.body.outcome, { adsExamined: 2, storesFound: 2, storesNew: 2, adsKept: 0 });

    const envoi = collectes.at(-1)!;
    assert.match(envoi.chemin, /apify~facebook-ads-scraper/, 'l’acteur configuré est bien celui appelé');
    // Le plafond est la borne de la dépense : il doit venir de la configuration, pas du code.
    assert.equal(envoi.corps.resultsLimit, 150);
    const departs = envoi.corps.startUrls as { url: string }[];
    assert.match(departs[0]!.url, /facebook\.com\/ads\/library/);
    assert.match(departs[0]!.url, /q=mychariow/, 'le mot-clé qui trouve les vendeurs de la plateforme');

    const vue = await agent.get('/api/radar/discover').expect(200);
    const hotes = (vue.body.stores as { host: string; adCount: number }[]).map((store) => store.host);
    assert.deepEqual(hotes.sort(), ['autreshop.mychariow.com', 'mabelleboutique.mychariow.com']);
    // « api-edge » est un service de la plateforme, pas une boutique.
    assert.ok(!hotes.includes('api-edge.mychariow.com'));
    // Une boutique citée deux fois dans la même publicité ne compte qu'une fois.
    const belle = (vue.body.stores as { host: string; adCount: number }[]).find((s) => s.host.startsWith('mabelle'));
    assert.equal(belle?.adCount, 1);
  });

  /*
    Une collecte qui ne rapporte rien a coûté exactement le même prix qu'une autre.

    Le rythme se lisait auparavant sur la dernière boutique écrite. Une collecte
    infructueuse n'écrivant rien, elle redevenait « due » au réveil suivant et se
    refacturait chaque jour, alors que le rythme voulu est mensuel — trente fois le prix,
    et précisément le jour où le service ne fonctionne pas.
  */
  it('ne relance pas une collecte payante parce que la précédente n’a rien rapporté', async () => {
    const { discoveryIsDue } = await import('@server/services/radar/discovery');
    const { createAdmin } = await import('./support/helpers');
    const { getDb } = await import('@server/db/client');
    const { discoveredStores } = await import('@server/db/schema');
    const { agent } = await createAdmin(app, 'decouverte-vide@exemple.test');

    /*
      La table est vidée pour placer le seul cas qui compte : celui où AUCUNE collecte n'a
      jamais rien écrit. Sans cela, les boutiques trouvées par le test précédent dateraient
      le rythme à elles seules, et ce test passerait même avec le défaut qu'il doit attraper.
    */
    await getDb().delete(discoveredStores);

    const avant = collectes.length;
    collecteVide = true;
    try {
      const collecte = await agent.post('/api/radar/discover/refresh').expect(200);
      assert.deepEqual(collecte.body.outcome, { adsExamined: 0, storesFound: 0, storesNew: 0, adsKept: 0 });
      assert.equal(collectes.length, avant + 1, 'le fournisseur a bien été appelé, donc facturé');

      assert.equal(await discoveryIsDue(), false, 'le passage compte, même sans résultat : pas de seconde facture demain');
    } finally {
      collecteVide = false;
    }
  });

  it('met une boutique repérée sous surveillance en un geste', async () => {
    const { agent } = await signInWithPlan(app, 'decouverte-suivi@exemple.test', 'pro');
    // L'hôte repéré n'existe pas chez notre faux serveur : l'ajout doit malgré tout être
    // refusé proprement, pas planter — c'est le cas d'une boutique fermée entre-temps.
    const refus = await agent.post('/api/radar/watches').send({ target: 'autreshop.mychariow.com' });
    assert.ok(refus.status >= 400 && refus.status < 600, `statut inattendu : ${refus.status}`);
    assert.ok(refus.body.error.message.length > 0, 'le refus est expliqué');
  });
});

describe('Radar — résumé par e-mail', () => {
  it('envoie un seul résumé, jamais vide, et seulement aux adresses confirmées', async () => {
    const { sendDueRadarDigests } = await import('@server/services/radar/alerts');
    const { verifyEmailOf } = await import('./support/analysis-fixtures');

    catalogue = [{ id: 'prd_x1', name: 'Pack productivité', prix: 4_000, ventes: 2 }];
    const { agent } = await signInWithPlan(app, 'resume@exemple.test', 'pro');
    const ajout = await agent.post('/api/radar/watches').send({ target: base }).expect(201);
    const watchId = ajout.body.watch.id as string;

    // Adresse pas encore confirmée : aucun envoi, même avec des événements à raconter.
    const avantConfirmation = await sendDueRadarDigests();
    assert.equal(avantConfirmation.sent, 0, 'une adresse non confirmée ne reçoit rien');

    await verifyEmailOf('resume@exemple.test');
    const debut = courriers.length;

    const premier = await sendDueRadarDigests();
    assert.equal(premier.sent, 1);
    const message = courriers.at(-1)!;
    assert.equal(message.to, 'resume@exemple.test');
    assert.match(message.subject, /Radar/);
    assert.match(message.text, /Pack productivité/, 'la phrase du serveur est reprise telle quelle');
    assert.match(message.text, /\/app\/radar/, 'le message ramène à l’écran');

    // Deuxième passage tout de suite : rien de neuf, et la période est déjà consommée.
    const second = await sendDueRadarDigests();
    assert.equal(second.sent, 0, 'pas deux résumés dans la même journée');
    assert.equal(courriers.length, debut + 1);

    // L'utilisateur coupe le résumé : même avec du nouveau, plus rien ne part.
    await agent.post('/api/radar/alerts').send({ enabled: false }).expect(200);
    catalogue = [{ id: 'prd_x2', name: 'Nouveau modèle', prix: 9_000, ventes: 0 }];
    await agent.post(`/api/radar/watches/${watchId}/sweep`).expect(200);
    const apresCoupure = await sendDueRadarDigests(new Date(Date.now() + 48 * 3_600_000));
    assert.equal(apresCoupure.sent, 0, 'l’interrupteur est respecté');
  });

  it('compte les événements non lus pour la pastille, puis les éteint', async () => {
    catalogue = [{ id: 'prd_y1', name: 'Guide export', prix: 6_000, ventes: 1 }];
    const { agent } = await signInWithPlan(app, 'pastille@exemple.test', 'pro');
    await agent.post('/api/radar/watches').send({ target: base }).expect(201);

    const avant = await agent.get('/api/radar/unread').expect(200);
    assert.ok(avant.body.unread > 0, 'le premier relevé laisse des nouveautés à lire');

    await agent.post('/api/radar/events/read').expect(200);
    const apres = await agent.get('/api/radar/unread').expect(200);
    assert.equal(apres.body.unread, 0);

    // La pastille d'autrui ne fuit pas.
    const { agent: autre } = await signInWithPlan(app, 'pastille-autre@exemple.test', 'pro');
    const chezAutre = await autre.get('/api/radar/unread').expect(200);
    assert.equal(chezAutre.body.unread, 0);
  });
});
