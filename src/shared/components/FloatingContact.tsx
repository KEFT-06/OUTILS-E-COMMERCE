import { Link, useLocation } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/shared/ui/button';

/**
 * Bouton de contact flottant, sur les pages publiques.
 *
 * Quelqu'un qui hésite sur la page d'accueil, sur les tarifs ou sur une page légale n'ira
 * pas chercher un lien en pied de page : il repart. Le bouton le suit pendant qu'il lit.
 *
 * DEUX ENDROITS OÙ IL NE S'AFFICHE PAS, et ce sont les deux qui comptent :
 *
 *  · la page de contact elle-même — un bouton qui mène là où l'on est déjà est du bruit ;
 *  · tout l'espace de travail, où il recouvrirait la barre de navigation mobile et où
 *    « Mon compte » offre déjà une aide. Il ne sert qu'à celui qui n'est pas encore client.
 */

/** Écrans où un bouton flottant gênerait plus qu'il n'aiderait. */
const MUET = [/^\/app(\/|$)/, /^\/contact\/?$/, /^\/connexion\/?$/, /^\/mot-de-passe-oublie\/?$/];

export function FloatingContact() {
  const { pathname } = useLocation();
  if (MUET.some((motif) => motif.test(pathname))) return null;

  return (
    <Button
      asChild
      size="sm"
      /*
        Placé au-dessus du bandeau cookies tant qu'il est là, et jamais sous lui : un bouton
        à demi caché derrière un bandeau se clique de travers, ou pas du tout.
      */
      className="fixed right-4 bottom-24 z-40 rounded-full shadow-lg sm:bottom-20"
    >
      <Link to="/contact">
        <MessageSquare />
        Nous écrire
      </Link>
    </Button>
  );
}
