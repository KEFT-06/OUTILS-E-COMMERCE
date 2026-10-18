import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Express } from 'express';
import jpeg from 'jpeg-js';
import request from 'supertest';
import { closeTestApp, createTestApp } from './support/helpers';

/**
 * Collecte massive (Firecrawl, 18/10/2026) : des milliers d'annonces en une fois. Leurs aperçus
 * sont copiés pendant le versement, tant que les adresses de Meta vivent, et réduits avant d'être
 * gardés ; chaque versement dit combien d'annonces le mur n'avait jamais vues. Faux Meta et faux
 * stockage seulement.
 */

const SECRET = 'secret-du-planificateur-de-test';
const CLE = 'sb_secret_cle_de_test_0000000000';

/** Une vraie photo JPEG, assez riche pour peser ce que pèse un aperçu de vidéo de Meta. */
function photo(width: number, height: number): Buffer {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      data[at] = (x * 7 + y) % 256;
      data[at + 1] = (y * 3) % 256;
      data[at + 2] = ((x + y) * 5) % 256;
      data[at + 3] = 255;
    }
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 90).data);
}
const GRANDE = photo(1080, 1920);
const PETITE = photo(400, 400);

const objets = new Map<string, Buffer>();
let base = '';

const faux = createServer((req, res) => {
  const morceaux: Buffer[] = [];
  req.on('data', (morceau: Buffer) => morceaux.push(morceau));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://local');
    const corps = Buffer.concat(morceaux);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // ——— Faux serveur d'images de Meta ———
    if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
      const image = url.pathname.endsWith('grande.jpg') ? GRANDE : PETITE;
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(image.length) });
      res.end(image);
      return;
    }
    // ——— Faux Supabase Storage ———
    if (url.pathname.startsWith('/storage/v1/')) {
      if (req.headers.authorization !== `Bearer ${CLE}`) return json(401, { message: 'Unauthorized' });
      if (req.method === 'POST' && url.pathname === '/storage/v1/bucket') return json(200, { name: 'espionnage' });
      const depot = /^\/storage\/v1\/object\/espionnage\/(.+)$/.exec(url.pathname);
      if (req.method === 'POST' && depot) {
        objets.set(depot[1]!, corps);
        return json(200, { Key: `espionnage/${depot[1]!}` });
      }
    }
    json(404, { detail: 'Not Found' });
  });
});

let app: Express;

before(async () => {
  await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(faux.address() as AddressInfo).port}`;
  app = await createTestApp({ CRON_SECRET: SECRET, SUPABASE_API_SECRET_KEY: CLE, SUPABASE_URL: base });
});
after(async () => {
  await closeTestApp();
  await new Promise<void>((r) => faux.close(() => r()));
});

/** Une annonce de la bibliothèque, sous sa forme réelle (snake_case), menant à une boutique de la plateforme. */
const annonce = (id: string, image: string) => ({
  ad_archive_id: id,
  is_active: true,
  start_date: Math.floor(Date.now() / 1000) - 20 * 86_400,
  collation_count: 1,
  publisher_platform: ['FACEBOOK'],
  page_id: `90${id}`,
  page_name: `Annonceur ${id}`,
  snapshot: {
    link_url: `https://boutique${id}.mychariow.shop/prd_${id}`,
    caption: `boutique${id}.mychariow.shop`,
    title: 'Offre du jour',
    body: { text: 'Un guide pour vendre en ligne.' },
    images: [{ resized_image_url: image, original_image_url: image }],
    videos: [],
    cards: [],
    page_name: `Annonceur ${id}`,
    display_format: 'IMAGE',
  },
});

const verser = (body: Record<string, unknown>) => request(app).post('/api/cron/collecte').set('Authorization', `Bearer ${SECRET}`).send(body);

describe('Collecte massive : aperçus et annonces nouvelles', () => {
  it('copie les aperçus du lot pendant le versement, réduits, et compte les annonces jamais vues', async () => {
    const lot = [annonce('2001', `${base}/images/grande.jpg`), annonce('2002', `${base}/images/petite.jpg`)];
    const premier = await verser({ country: 'CM', items: lot, apercus: true }).expect(200);
    assert.equal(premier.body.adsKept, 2);
    assert.equal(premier.body.adsNew, 2);
    assert.deepEqual(premier.body.thumbnails, { stored: 2, failed: 0 });

    const reduite = objets.get('ads/2001.jpg')!;
    const lue = jpeg.decode(reduite);
    assert.equal(Math.max(lue.width, lue.height), 640, 'ramenée à 640 points sur son plus grand côté');
    assert.equal(lue.width, 360, 'proportions gardées');
    assert.ok(reduite.length < GRANDE.length / 3, `${reduite.length} octets contre ${GRANDE.length}`);
    assert.deepEqual(objets.get('ads/2002.jpg'), PETITE, 'une image déjà petite est gardée telle quelle');

    const second = await verser({ country: 'CI', items: lot }).expect(200);
    assert.equal(second.body.adsKept, 2);
    assert.equal(second.body.adsNew, 0, 'déjà sur le mur : rien de nouveau');
    assert.equal(second.body.thumbnails, undefined, 'sans la demande, le versement ne copie rien (le collecteur maison garde son rythme)');
  });

  it('garde telle quelle une image qu’il ne sait pas alléger', async () => {
    const { shrinkThumbnail } = await import('@server/services/espionnage/thumbnail');
    const png = { bytes: Buffer.from('89504e470d0a1a0a0000', 'hex'), type: 'image/png' };
    assert.equal(shrinkThumbnail(png), png);
    const tronquee = { bytes: Buffer.from('ffd8ffe000104a46494600', 'hex'), type: 'image/jpeg' };
    assert.equal(shrinkThumbnail(tronquee), tronquee);
  });
});
