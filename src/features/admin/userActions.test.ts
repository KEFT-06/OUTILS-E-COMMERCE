import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@/shared/types/auth';
import { readUserAction, userActionHref, userActionsFor } from './userActions';

const TOUT: Permission[] = ['admin.users.read', 'admin.users.manage', 'admin.credits.grant'];

describe('actions sur un compte, depuis la liste comme depuis la fiche', () => {
  it('un administrateur peut tout faire sur le compte d’un client', () => {
    assert.deepEqual(userActionsFor({ id: 'admin', role: 'admin', permissions: TOUT }, { id: 'client', role: 'user' }), [
      'points',
      'palier',
      'deconnecter',
      'bloquer',
      'supprimer',
    ]);
  });

  it('sur son propre compte, il ne peut ni se bloquer, ni se déconnecter, ni se supprimer d’ici', () => {
    assert.deepEqual(userActionsFor({ id: 'admin', role: 'admin', permissions: TOUT }, { id: 'admin', role: 'admin' }), ['points', 'palier']);
  });

  it('un membre de l’équipe ne touche pas un administrateur, et ne supprime personne', () => {
    const membre = { id: 'membre', role: 'user', permissions: TOUT };
    assert.deepEqual(userActionsFor(membre, { id: 'admin', role: 'admin' }), []);
    assert.deepEqual(userActionsFor(membre, { id: 'client', role: 'user' }), ['points', 'palier', 'deconnecter', 'bloquer']);
    assert.deepEqual(userActionsFor({ ...membre, permissions: ['admin.credits.grant'] }, { id: 'client', role: 'user' }), ['points']);
  });

  it('l’adresse de la fiche porte l’action, et seule une action connue est lue', () => {
    assert.equal(userActionHref('abc', 'supprimer'), '/app/admin/utilisateurs/abc?action=supprimer');
    assert.equal(readUserAction('bloquer'), 'bloquer');
    assert.equal(readUserAction('effacer-tout'), null);
    assert.equal(readUserAction(null), null);
  });
});
