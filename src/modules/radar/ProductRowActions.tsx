import { Link } from 'react-router-dom';
import { ExternalLink, Megaphone, Sparkles } from 'lucide-react';
import { STOREFRONT_LABELS, storefrontOfHost } from '@server/shared/storefronts';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { formatDateFr } from '@/shared/lib/formatDate';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { Button } from '@/shared/ui/button';

/**
 * Sur chaque ligne de produit du Radar : sa première publicité sur Meta, et trois gestes.
 *
 *   · voir son annonce sur le mur d'espionnage — filtré sur CE produit quand il a les siennes,
 *     sur sa boutique sinon ;
 *   · ouvrir sa page sur la vitrine du vendeur ;
 *   · l'analyser comme une niche, pour en créer un proche — derrière la porte de points, qui
 *     affiche le coût avant de lancer.
 *
 * Les trois tableaux du Radar (boutique surveillée, fiche d'une boutique, concurrence d'une niche)
 * partagent ce composant : un produit se lit et s'utilise de la même façon partout.
 */

/** Date de la première publicité connue du produit sur Meta ; rien d'inventé quand aucune n'a été repérée. */
export function FirstAdCell({ firstAdAt }: { firstAdAt: string | null }) {
  return firstAdAt ? <span className="whitespace-nowrap">{formatDateFr(firstAdAt)}</span> : <span className="text-muted-foreground">aucune repérée</span>;
}

export function ProductRowActions({
  name,
  host,
  slug,
  externalId,
  url,
  productAds,
  storeAds,
}: {
  name: string;
  /** Hôte de la vitrine ; null : boutique dont l'adresse n'est pas connue. */
  host: string | null;
  slug: string | null;
  /** Identifiant du produit, « prd_… » : certaines annonces mènent à lui plutôt qu'à son nom d'adresse. */
  externalId: string;
  url: string | null;
  /** Publicités connues de ce produit, puis de sa boutique : elles décident où mène le premier bouton. */
  productAds: number;
  storeAds: number;
}) {
  const { analyzeNiche } = useWorkspace();
  const page = safeHttpUrl(url ?? undefined);
  const vitrine = STOREFRONT_LABELS[storefrontOfHost(host) ?? 'chariow'];
  const cles = [slug, externalId].filter(Boolean).join(',');
  const annonces = host && (productAds > 0 || storeAds > 0) ? `/app/espionnage?boutique=${encodeURIComponent(host)}${productAds > 0 && cles ? `&produit=${encodeURIComponent(cles)}` : ''}` : null;

  return (
    <div className="flex flex-nowrap justify-end gap-1.5">
      {annonces ? (
        <Button asChild size="sm" variant="outline" title={productAds > 0 ? 'Voir l’annonce de ce produit dans l’Espionnage' : 'Voir les annonces de sa boutique dans l’Espionnage'}>
          <Link to={annonces} aria-label={`Voir l’annonce de « ${name} » dans l’Espionnage`}>
            <Megaphone />
            Annonce
          </Link>
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled title="Aucune publicité repérée pour ce produit ni pour sa boutique">
          <Megaphone />
          Annonce
        </Button>
      )}
      {page && (
        <Button asChild size="sm" variant="outline" title={`Voir le produit sur ${vitrine}`}>
          <a href={page} target="_blank" rel="noreferrer noopener" aria-label={`Voir « ${name} » sur ${vitrine}`}>
            <ExternalLink />
            {vitrine}
          </a>
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        title="Analyser ce produit dans Niches pour créer un produit similaire"
        aria-label={`Analyser « ${name} » pour créer un produit similaire`}
        // Un titre de vitrine peut faire trois lignes : l'analyse part de son début, qui dit le sujet.
        onClick={() => void analyzeNiche(name.replace(/\s+/g, ' ').trim().slice(0, 120))}
      >
        <Sparkles />
        Produit similaire
      </Button>
    </div>
  );
}
