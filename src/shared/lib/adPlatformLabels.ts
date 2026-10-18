/**
 * Noms français des objectifs de campagne et des boutons d'action de Meta et TikTok.
 *
 * La configuration garde le nom OFFICIEL anglais (celui des documentations, vérifié à une date) ;
 * l'écran, lui, est en français, comme le gestionnaire de publicités de la plupart de nos clients.
 * « Sales » ou « Shop Now » seuls, au milieu d'une page en français, se lisaient comme un oubli
 * (relevé le 18/10/2026). L'écran donne donc le nom français, suivi du nom anglais entre parenthèses
 * pour qui a son gestionnaire en anglais.
 */

const OBJECTIFS: Record<string, string> = {
  Awareness: 'Notoriété',
  Traffic: 'Trafic',
  Engagement: 'Interactions',
  Leads: 'Prospects',
  'App promotion': 'Promotion de l’application',
  Sales: 'Ventes',
  Reach: 'Couverture',
  'Video views': 'Vues de vidéo',
  'Lead generation': 'Génération de prospects',
};

const BOUTONS: Record<string, string> = {
  'Apply Now': 'Postuler',
  'Book Now': 'Réserver',
  'Call Now': 'Appeler',
  'Contact Us': 'Nous contacter',
  Download: 'Télécharger',
  'Get Directions': 'Itinéraire',
  'Get Offer': 'Profiter de l’offre',
  'Get Quote': 'Demander un devis',
  'Get Showtimes': 'Voir les séances',
  Interested: 'Ça m’intéresse',
  'Learn More': 'En savoir plus',
  'Listen Now': 'Écouter',
  'Open Link': 'Ouvrir le lien',
  'Order Now': 'Commander',
  'Play Game': 'Jouer',
  Preregister: 'Préinscription',
  'Request Time': 'Demander un horaire',
  Save: 'Enregistrer',
  'See Menu': 'Voir le menu',
  'Send Message': 'Envoyer un message',
  'Send WhatsApp Message': 'Envoyer un message WhatsApp',
  'Shop Now': 'Acheter',
  'Sign Up': 'S’inscrire',
  Subscribe: 'S’abonner',
  'View Event': 'Voir l’évènement',
  'Watch More': 'Regarder plus',
};

const avecOfficiel = (francais: string | undefined, officiel: string) => (francais ? `${francais} (${officiel})` : officiel);

/** « Ventes (Sales) » : le nom français d'un objectif, et son nom officiel. */
export const objectiveLabel = (officialName: string) => avecOfficiel(OBJECTIFS[officialName], officialName);

/** « Acheter (Shop Now) » : le nom français d'un bouton d'action, et son nom officiel. */
export const callToActionLabel = (officialName: string) => avecOfficiel(BOUTONS[officialName], officialName);
