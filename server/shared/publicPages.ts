/**
 * Pages publiques du site : titre, description et place dans le plan du site.
 *
 * Partagé par le serveur (balises servies aux robots et aux aperçus de liens, qui
 * n'exécutent pas le JavaScript) et par le navigateur (balises mises à jour à chaque
 * changement de page). Une seule source : les deux ne peuvent pas diverger.
 */

export interface PublicPage {
  path: string;
  title: string;
  description: string;
  changefreq: 'weekly' | 'monthly' | 'yearly';
  priority: string;
}

export const SITE_NAME = 'Smart Creator';

export const PUBLIC_PAGES: readonly PublicPage[] = [
  {
    path: '/',
    title: 'Smart Creator — Veille stratégique, production et création d’e-commerce',
    description:
      'Smart Creator relie la lecture du marché, la production de produits digitaux et leur mise en vente, pour les créateurs d’Afrique francophone. Chaque chiffre affiché porte sa source.',
    changefreq: 'weekly',
    priority: '1.0',
  },
  {
    path: '/connexion',
    title: 'Connexion · Smart Creator',
    description:
      'Connectez-vous à votre espace Smart Creator ou créez votre compte gratuit : analyses de niche, studio de produits digitaux, kits de lancement et campagnes.',
    changefreq: 'monthly',
    priority: '0.6',
  },
  {
    path: '/contact',
    title: 'Contact · Smart Creator',
    description:
      'Une question sur Smart Creator, un problème de compte, un paiement ou une demande sur vos données personnelles ? Écrivez-nous, la réponse arrive par e-mail.',
    changefreq: 'yearly',
    priority: '0.5',
  },
  {
    path: '/mentions-legales',
    title: 'Mentions légales · Smart Creator',
    description: 'Éditeur, hébergement et propriété intellectuelle du site Smart Creator.',
    changefreq: 'yearly',
    priority: '0.2',
  },
  {
    path: '/confidentialite',
    title: 'Politique de confidentialité · Smart Creator',
    description:
      'Quelles données Smart Creator conserve, où et combien de temps, avec quels services elles sont partagées et comment les télécharger ou les supprimer.',
    changefreq: 'yearly',
    priority: '0.3',
  },
  {
    path: '/conditions',
    title: 'Conditions d’utilisation · Smart Creator',
    description:
      'Règles d’utilisation de Smart Creator : compte, points de recherche, paiement des paliers, contenus générés et conformité publicitaire.',
    changefreq: 'yearly',
    priority: '0.3',
  },
];

export function findPublicPage(path: string): PublicPage | undefined {
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return PUBLIC_PAGES.find((page) => page.path === normalized);
}
