import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cacheEpoch, forgetResponses, lastKnown, remember } from '@/shared/lib/apiCache';

/**
 * Mémoire des écrans.
 *
 * Le cas qui justifie ce fichier est le dernier : sur un poste partagé (cybercafé, téléphone
 * prêté), une réponse demandée par un compte et arrivée après la connexion d'un autre ne doit
 * jamais lui être montrée, même une fraction de seconde.
 */
describe('Mémoire des écrans', () => {
  it('rend la dernière réponse connue d’une adresse, et rien pour une adresse jamais lue', () => {
    forgetResponses();
    remember('/api/radar', { watches: [1] });
    assert.deepEqual(lastKnown('/api/radar'), { watches: [1] });
    assert.equal(lastKnown('/api/espionnage'), null);
  });

  it('oublie une adresse dont la dernière valeur est vide', () => {
    forgetResponses();
    remember('/api/radar/discover', { stores: [] });
    remember('/api/radar/discover', null);
    assert.equal(lastKnown('/api/radar/discover'), null);
  });

  it('ne grossit pas sans fin : les adresses les plus anciennes sont oubliées', () => {
    forgetResponses();
    for (let n = 0; n < 120; n += 1) remember(`/api/espionnage?page=${n}`, { n });
    assert.equal(lastKnown('/api/espionnage?page=0'), null, 'la plus ancienne est partie');
    assert.deepEqual(lastKnown('/api/espionnage?page=119'), { n: 119 }, 'la plus récente est là');
  });

  it('se vide au changement de compte', () => {
    remember('/api/account/sessions', [{ id: 'a' }]);
    forgetResponses();
    assert.equal(lastKnown('/api/account/sessions'), null);
  });

  it('ignore la réponse d’un compte arrivée après la connexion d’un autre', () => {
    forgetResponses();
    // Le premier compte lance une lecture lente…
    const demandeeSous = cacheEpoch();
    // … se déconnecte, un autre se connecte…
    forgetResponses();
    // … et la réponse du premier arrive enfin.
    remember('/api/radar', { watches: ['boutique-du-premier-compte'] }, demandeeSous);
    assert.equal(lastKnown('/api/radar'), null, 'rien du premier compte n’est gardé pour le second');
  });
});
