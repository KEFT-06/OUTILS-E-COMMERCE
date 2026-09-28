import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { formatDateFr } from '@/shared/lib/formatDate';

/**
 * Les dates « de calendrier » (vérification d'une source, mise à jour d'une grille) arrivent
 * sans heure. Lues comme minuit UTC, elles reculaient d'un jour pour tout appareil à l'ouest
 * de Greenwich.
 */
describe('Date lisible en français', () => {
  const fuseau = process.env.TZ;
  after(() => {
    if (fuseau === undefined) delete process.env.TZ;
    else process.env.TZ = fuseau;
  });

  it('garde le jour d’une date sans heure, même à Toronto', () => {
    process.env.TZ = 'America/Toronto';
    assert.equal(formatDateFr('2026-09-23'), '23 septembre 2026');
    process.env.TZ = 'Africa/Douala';
    assert.equal(formatDateFr('2026-09-23'), '23 septembre 2026');
  });

  it('lit toujours un horodatage complet dans le fuseau de l’appareil', () => {
    process.env.TZ = 'America/Toronto';
    assert.equal(formatDateFr('2026-09-23T02:00:00Z'), '22 septembre 2026');
  });

  it('rend telle quelle une entrée qui n’est pas une date', () => {
    assert.equal(formatDateFr('bientôt'), 'bientôt');
  });
});
