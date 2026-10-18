/**
 * Éléments culturels proposés pour ancrer un conte illustré dans son pays : vêtements, marché, plats,
 * paysages, transports — ce qu'un enfant de ce pays reconnaît sur une page. Ce sont des repères
 * familiers et sûrs, à compléter ou retirer par l'auteur ; aucun fait historique ni croyance.
 *
 * La case restait vide « faute de fait vérifiable » ; le propriétaire (18/10/2026) demande que tout
 * ce qui se remplit le soit par l'outil, l'utilisateur ne faisant que corriger.
 */

const ELEMENTS: Record<string, string> = {
  CM: 'pagne aux motifs wax, marché animé, ndolé et beignets-haricots, taxis jaunes, collines verdoyantes de l’Ouest',
  CI: 'pagne wax, maquis et attiéké-poisson, alloco, lagune d’Abidjan, gbakas colorés',
  SN: 'boubou brodé, thiéboudiène partagé autour du bol, pirogues de pêcheurs peintes, baobabs, cars rapides colorés',
  BJ: 'pagne wax, marché de Dantokpa, zémidjans, village lacustre de Ganvié, palmiers',
  TG: 'pagne wax, marché de Lomé, motos-taxis, cocotiers du bord de mer, fufu',
  BF: 'Faso dan fani, maisons en banco, baobabs et karités, vélos et mobylettes, tô',
  ML: 'bogolan, architecture en banco, pirogues sur le fleuve Niger, thé à la menthe partagé',
  NE: 'turbans et boubous, maisons en banco, fleuve Niger, dromadaires, thé partagé',
  GN: 'pagne coloré, collines et cascades du Fouta-Djalon, marché animé, riz sauce arachide',
  GA: 'forêt équatoriale, pagne, marché de Libreville, plages de l’océan, grands arbres d’okoumé',
  CG: 'pagne, fleuve Congo, marchés de Brazzaville, élégance de la sape, saka-saka',
  CD: 'pagne, fleuve Congo, rumba congolaise, marchés animés de Kinshasa, élégance de la sape',
  TD: 'boubous, savane et dromadaires, lac Tchad, thé partagé, boule de mil',
  CF: 'pagne, forêt et rivières, marché de Bangui, manioc',
  MG: 'lamba, rizières en terrasses, baobabs, zébus, taxis-brousse',
  RW: 'collines verdoyantes, plantations de thé, art imigongo aux motifs géométriques, pagne',
  BI: 'collines verdoyantes, tambours, lac Tanganyika, plantations de café',
  DJ: 'désert et lac Assal, boubous, port animé, thé partagé',
  MR: 'daraa, désert et dunes, tentes, thé à la menthe',
  MA: 'djellaba, médina et souk, zellige, thé à la menthe, tajine',
  TN: 'maisons blanches aux portes bleues, médina, chéchia, couscous, oliviers',
  DZ: 'casbah, karakou, couscous, palmeraies du Sud, thé',
  HT: 'tap-taps peints, marché coloré, peinture naïve, montagnes, riz collé',
  NG: 'ankara, danfos jaunes de Lagos, marché animé, jollof rice',
  GH: 'kente, marché de Makola, trotros, jollof rice',
  KE: 'kanga, matatus colorés, savane et girafes, ugali',
  FR: 'boulangerie, marché du village, école, vélo, parc',
  BE: 'frites et gaufres, bandes dessinées, rues pavées, vélo',
  CA: 'érables rouges, neige et luge, sirop d’érable, grands lacs',
  CH: 'montagnes, chalets, lacs, petit train',
};

/** Pays sans repères propres : des éléments familiers partout, que l'auteur précise. */
const PARTOUT = 'marché du quartier, tenues traditionnelles, plats du pays, paysages familiers';

/** Fonction pure : les éléments culturels proposés pour un pays (ISO alpha-2). */
export function culturalElementsOf(country: string | null | undefined): string {
  return ELEMENTS[(country ?? '').toUpperCase()] ?? PARTOUT;
}
