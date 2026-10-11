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

  /*
    Tour du site du 11/10/2026 : une quinzaine de messages parlaient au client de ce qui ne regarde
    que l'administrateur. Il y lisait une panne, sans rien pouvoir y faire.
  */
  it('ne dit à un client ni réglage du serveur, ni clé, ni réponse brute d’un service', () => {
    const indisponible = 'Ce service est momentanément indisponible.';
    assert.equal(neutralizeMessage('Le service d’images refuse l’accès du serveur : l’administrateur doit vérifier sa configuration.'), indisponible);
    assert.equal(neutralizeMessage("Le service de rédaction automatique n'est pas disponible sur ce serveur : l'administrateur doit le configurer."), indisponible);
    assert.equal(neutralizeMessage('L’accès au service de rédaction est refusé : clé API invalide sur le serveur.'), indisponible);
    assert.equal(neutralizeMessage('La mesure de marché n’a pas abouti (réponse 502).'), indisponible);
    assert.equal(neutralizeMessage('Génération introuvable chez le fournisseur.'), indisponible);
    // Ce que le client doit savoir, lui, reste : ses points.
    assert.equal(
      neutralizeMessage('La rédaction des rapports n’est pas branchée sur ce serveur : l’administrateur doit la configurer. Aucun point n’a été retiré.'),
      'Ce service est momentanément indisponible. Aucun point n’a été retiré.',
    );
    // Un message qui parle au client n'est pas touché.
    for (const message of ['Ce compte est bloqué. Contactez l’administrateur de Smart Creator.', 'Action réservée aux administrateurs.', 'Le rendu vidéo est momentanément indisponible : l’administrateur en a été informé. Vos points ont été rendus.']) {
      assert.equal(neutralizeMessage(message), message);
    }
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
