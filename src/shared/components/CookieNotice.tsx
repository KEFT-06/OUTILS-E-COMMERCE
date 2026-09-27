import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie, X } from 'lucide-react';
import { Button } from '@/shared/ui/button';

/**
 * Bandeau cookies — informatif, et non un consentement déguisé.
 *
 * CE CHOIX N'EN EST PAS UN, ET LE DIRE EST PLUS HONNÊTE QUE DE FAIRE SEMBLANT.
 *
 * Le site ne dépose que trois cookies, tous strictement nécessaires : `sc_session` garde la
 * connexion ouverte, `sc_mfa` porte le second facteur quelques minutes, `sidebar_state`
 * retient si la barre latérale est repliée. Aucun cookie publicitaire, aucun traceur, et la
 * mesure d'audience se fait sans cookie du tout.
 *
 * Des cookies strictement nécessaires ne se refusent pas — les refuser, ce serait refuser de
 * se connecter. Afficher deux boutons « Accepter » et « Refuser » sur ces trois-là mimerait
 * un choix qui n'existe pas : soit le refus ne fait rien, et c'est un mensonge d'interface,
 * soit il déconnecte, et c'est une sanction déguisée en liberté.
 *
 * Le bandeau informe donc, renvoie au détail, et se ferme. Le jour où un cookie non
 * nécessaire apparaîtra — une mesure d'audience tierce, un pixel publicitaire — il faudra un
 * VRAI consentement : deux boutons d'égale valeur, refus aussi simple qu'acceptation, et
 * aucun dépôt avant la réponse. Ce composant ne servira alors plus, et c'est voulu : il ne
 * doit pas pouvoir être recyclé en habillage d'un choix qu'il ne recueille pas.
 */

const CLE = 'sc.cookieNotice.vu';

export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    /*
      Le bandeau ne s'affiche qu'après le premier rendu, et son état vit dans le stockage
      local plutôt que dans un cookie : annoncer qu'on ne dépose que le strict nécessaire, en
      déposant un cookie pour le dire, serait une contradiction visible par quiconque ouvre
      les outils du navigateur.

      Une lecture peut échouer — navigation privée, stockage bloqué. Dans ce cas le bandeau
      s'affiche : mieux vaut informer deux fois que pas du tout.
    */
    try {
      setVisible(window.localStorage.getItem(CLE) !== '1');
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const fermer = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(CLE, '1');
    } catch {
      // Stockage indisponible : le bandeau reviendra à la prochaine visite. Sans gravité.
    }
  };

  return (
    <div
      role="region"
      aria-label="Information sur les cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Cookie className="mt-0.5 size-5 shrink-0 text-muted-foreground sm:mt-0" aria-hidden="true" />
        <p className="flex-1 text-sm leading-relaxed">
          Ce site dépose trois cookies, tous nécessaires à son fonctionnement : rester connecté, valider le second
          facteur, et retenir si le menu est replié. Aucun cookie publicitaire, aucun traceur, et l’audience est
          mesurée sans cookie.{' '}
          <Link to="/confidentialite" className="font-medium underline underline-offset-2">
            Le détail
          </Link>
          .
        </p>
        <Button size="sm" variant="secondary" onClick={fermer} className="shrink-0 self-stretch sm:self-auto">
          <X />
          J’ai compris
        </Button>
      </div>
    </div>
  );
}
