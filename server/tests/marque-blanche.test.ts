import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import express from 'express';
import request from 'supertest';
import { AppError, errorHandler } from '@server/middleware';
import { neutralizeCode, neutralizeMessage } from '@server/shared/whiteLabel';

/**
 * Marque blanche : un utilisateur ne doit jamais apprendre quel fournisseur fait tourner le
 * service. Demandé par le propriétaire le 28/09/2026 : « l'utilisateur ne doit pas savoir que
 * j'utilise tel ou tel ».
 *
 * Deux verrous : les messages d'erreur du serveur sont écrits sans ces noms (vérifié en lisant
 * le code), et le gestionnaire d'erreurs neutralise ce qui passerait quand même.
 */

const NOMS = /\b(Gemini|Perplexity|Gamma|Apify|Cloudflare|fal\.ai|Veo|Higgsfield|Nano Banana)\b|chez Google/;

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? fichiers(chemin) : chemin.endsWith('.ts') ? [chemin] : [];
  });
}

describe('Marque blanche', () => {
  it('écrit tous les messages d’erreur visibles sans nom de fournisseur', () => {
    const racine = join(process.cwd(), 'server');
    const exempts = [/[\\/]admin[\\/]/, /[\\/]routes[\\/]admin\.ts$/, /[\\/]auth[\\/]google\.ts$/];
    const fautifs: string[] = [];
    for (const fichier of [...fichiers(join(racine, 'services')), ...fichiers(join(racine, 'routes')), ...fichiers(join(racine, 'middleware'))]) {
      if (exempts.some((motif) => motif.test(fichier))) continue;
      const source = readFileSync(fichier, 'utf8');
      for (let debut = source.indexOf('new AppError('); debut >= 0; debut = source.indexOf('new AppError(', debut + 1)) {
        // Le message est la première chaîne après le statut.
        const extrait = source.slice(debut, debut + 600);
        const message = /new AppError\(\s*\d+\s*,\s*(['"`])([\s\S]*?)\1/.exec(extrait)?.[2];
        if (message && NOMS.test(message)) fautifs.push(`${fichier.slice(racine.length + 1)} : ${message.slice(0, 80)}`);
      }
    }
    assert.deepEqual(fautifs, [], 'messages qui nomment un fournisseur');
  });

  it('neutralise un nom qui passerait quand même, en gardant une phrase lisible', () => {
    assert.equal(neutralizeMessage('Gemini n’a pas pu produire l’image.'), 'Le service n’a pas pu produire l’image.');
    assert.equal(neutralizeMessage('Le modèle est surchargé chez Google. Réessayez.'), 'Le modèle est surchargé. Réessayez.');
    assert.equal(neutralizeMessage('Réponse inattendue de Gamma.'), 'Réponse inattendue du service.');
    assert.equal(neutralizeMessage('Votre session a expiré.'), 'Votre session a expiré.', 'un message sans nom ne bouge pas');
    assert.equal(neutralizeCode('GEMINI_IMAGE_TIMEOUT'), 'IMAGE_TIMEOUT');
    assert.equal(neutralizeCode('VEO_UNAVAILABLE'), 'VIDEO_UNAVAILABLE');
    assert.equal(neutralizeCode('WRITING_OVERLOADED'), 'WRITING_OVERLOADED');
  });

  it('le gestionnaire d’erreurs neutralise pour les utilisateurs, pas pour l’administration', async () => {
    const app = express();
    const panne = () => {
      throw new AppError(503, 'Gemini est surchargé chez Google.', 'GEMINI_IMAGE_OVERLOADED');
    };
    app.get('/api/creatives/essai', panne);
    app.get('/api/admin/essai', panne);
    app.use(errorHandler);

    const utilisateur = await request(app).get('/api/creatives/essai').expect(503);
    assert.deepEqual(utilisateur.body.error, { code: 'IMAGE_OVERLOADED', message: 'Le service est surchargé.' });

    const administration = await request(app).get('/api/admin/essai').expect(503);
    assert.equal(administration.body.error.code, 'GEMINI_IMAGE_OVERLOADED', 'l’administration doit savoir quel service est en panne');
  });
});
