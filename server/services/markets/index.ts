import { z } from 'zod';
import { marketSchema } from '@server/middleware';

export type MarketCode = z.infer<typeof marketSchema>;

/**
 * Noms des marchés dans les langues des contenus générés.
 *
 * Les codes sont validés par `marketSchema`. `frOf` porte la forme contractée
 * (« du Sénégal ») : les textes partent tels quels chez les fournisseurs, qui les
 * reprennent mot pour mot — « le contexte de le Sénégal » serait imprimé ainsi.
 */
export const COUNTRY_NAMES: Record<MarketCode, { fr: string; frOf: string; en: string }> = {
  CI: { fr: "la Côte d'Ivoire", frOf: "de la Côte d'Ivoire", en: "Côte d'Ivoire" },
  SN: { fr: 'le Sénégal', frOf: 'du Sénégal', en: 'Senegal' },
  CM: { fr: 'le Cameroun', frOf: 'du Cameroun', en: 'Cameroon' },
  BJ: { fr: 'le Bénin', frOf: 'du Bénin', en: 'Benin' },
  TG: { fr: 'le Togo', frOf: 'du Togo', en: 'Togo' },
  BF: { fr: 'le Burkina Faso', frOf: 'du Burkina Faso', en: 'Burkina Faso' },
  ML: { fr: 'le Mali', frOf: 'du Mali', en: 'Mali' },
  NE: { fr: 'le Niger', frOf: 'du Niger', en: 'Niger' },
  GN: { fr: 'la Guinée', frOf: 'de la Guinée', en: 'Guinea' },
  CD: {
    fr: 'la République démocratique du Congo',
    frOf: 'de la République démocratique du Congo',
    en: 'the Democratic Republic of the Congo',
  },
  CG: { fr: 'la République du Congo', frOf: 'de la République du Congo', en: 'the Republic of the Congo' },
  GA: { fr: 'le Gabon', frOf: 'du Gabon', en: 'Gabon' },
  TD: { fr: 'le Tchad', frOf: 'du Tchad', en: 'Chad' },
  MG: { fr: 'Madagascar', frOf: 'de Madagascar', en: 'Madagascar' },
  MA: { fr: 'le Maroc', frOf: 'du Maroc', en: 'Morocco' },
  TN: { fr: 'la Tunisie', frOf: 'de la Tunisie', en: 'Tunisia' },
  DZ: { fr: "l'Algérie", frOf: "de l'Algérie", en: 'Algeria' },
};
