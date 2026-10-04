import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/shared/ui/button';

/**
 * Bouton « Retour ».
 *
 * Le navigateur a le sien, mais il est hors de portée du pouce sur un téléphone, absent quand
 * le site est ouvert depuis une application (WhatsApp, Facebook) ou épinglé à l'écran
 * d'accueil, et il ne dit rien de l'endroit où il mène. Celui-ci revient à l'écran précédent
 * DU SITE, jamais en dehors : sans écran précédent (lien ouvert directement, page rechargée),
 * il mène à `fallback`.
 *
 * Deux portées :
 *   · « site » : pages publiques — on revient à la page précédente de la visite ;
 *   · « app »  : espace connecté — on ne recule que vers un écran de l'espace connecté. Sans
 *     cela, « Retour » depuis le Cockpit renverrait à la page de connexion.
 */

/** Rang de la page courante dans l'historique de l'onglet, tenu par le routeur. */
function historyIndex(): number {
  const state = typeof window === 'undefined' ? null : (window.history.state as { idx?: unknown } | null);
  return typeof state?.idx === 'number' ? state.idx : 0;
}

/** Rang de la page par laquelle l'onglet est entré sur le site (ou a été rechargé). */
const siteFloor = historyIndex();
/** Rangs des écrans de l'espace connecté ouverts depuis le chargement de la page. */
const appEntries = new Set<number>();

/** Écran précédent disponible dans la portée, et de quoi y revenir. */
export function useBack(scope: 'site' | 'app', fallback: string | null) {
  const navigate = useNavigate();
  const { key, pathname } = useLocation();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    const index = historyIndex();
    if (scope === 'site') {
      setCanGoBack(index > siteFloor);
      return;
    }
    // Ce qui se trouvait après ce rang n'est plus sûr : une autre page a pu le remplacer.
    for (const entry of appEntries) if (entry > index) appEntries.delete(entry);
    appEntries.add(index);
    setCanGoBack(appEntries.has(index - 1));
  }, [key, scope]);

  const target = fallback !== null && fallback !== pathname ? fallback : null;
  return {
    canGoBack,
    available: canGoBack || target !== null,
    goBack: () => {
      if (canGoBack) void navigate(-1);
      else if (target) void navigate(target);
    },
  };
}

/** Écran de repli de l'espace connecté : la racine du module pour un sous-écran, sinon le Cockpit. */
export function appFallback(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 2) return `/${segments.slice(0, 2).join('/')}`;
  return pathname === '/app/cockpit' ? null : '/app/cockpit';
}

/** Flèche de la barre du haut de l'espace connecté. */
export function AppBackButton({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const { available, goBack } = useBack('app', appFallback(pathname));
  return (
    <Button variant="ghost" size="icon" className={className} onClick={goBack} disabled={!available} aria-label="Retour à l’écran précédent">
      <ArrowLeft />
    </Button>
  );
}

/** Lien des pages publiques : « Retour » vers la page d'où l'on vient, sinon « Accueil ». */
export function SiteBackButton() {
  const { canGoBack, goBack } = useBack('site', '/');
  return (
    <Button variant="ghost" size="sm" onClick={goBack}>
      <ArrowLeft />
      {canGoBack ? 'Retour' : 'Accueil'}
    </Button>
  );
}
