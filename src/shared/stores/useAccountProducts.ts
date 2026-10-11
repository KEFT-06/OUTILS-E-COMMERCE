import { useMemo } from 'react';
import { useCustomProducts } from '@/shared/stores/useCustomProducts';
import { useProductDrafts } from '@/shared/stores/useProductDrafts';
import { useRemovedProducts, withoutRemoved } from '@/shared/stores/useRemovedProducts';
import type { DigitalProductIdea, MarketAnalysisReport } from '@/shared/types/analysis';

/**
 * Les ouvrages du compte, d'où qu'ils viennent.
 *
 * Demande du propriétaire, 11/10/2026 : « tout ebook créé par l'utilisateur doit aller à Mes
 * créations », et « un utilisateur qui sort d'un module doit retrouver ce qu'il faisait ». Les
 * listes ne montraient que les produits de l'analyse OUVERTE : un ebook rédigé à partir d'une
 * autre niche disparaissait de tous les écrans dès qu'on changeait de niche, alors qu'il était
 * toujours enregistré sur le compte.
 *
 * Trois origines, donc : l'analyse ouverte, la création hors analyse (à la main, d'un texte,
 * d'une vidéo), et les ouvrages retouchés ou rédigés à partir d'une autre analyse — gardés par
 * leur version de travail. Ce que le compte a supprimé n'en fait plus partie.
 */
export interface AccountProducts {
  /** Produits de l'analyse ouverte. */
  fromReport: DigitalProductIdea[];
  /** Produits créés hors analyse. */
  custom: DigitalProductIdea[];
  /** Ouvrages travaillés à partir d'une autre analyse. */
  elsewhere: DigitalProductIdea[];
  /** Tous, dans cet ordre. */
  all: DigitalProductIdea[];
}

export function gatherProducts(input: {
  fromReport: readonly DigitalProductIdea[];
  custom: readonly DigitalProductIdea[];
  drafted: readonly DigitalProductIdea[];
  removed: readonly string[];
}): AccountProducts {
  const fromReport = withoutRemoved(input.fromReport, input.removed);
  const custom = [...input.custom];
  const known = new Set([...fromReport, ...custom].map((product) => product.id));
  const elsewhere = withoutRemoved(
    input.drafted.filter((product) => !known.has(product.id)),
    input.removed,
  );
  return { fromReport, custom, elsewhere, all: [...fromReport, ...custom, ...elsewhere] };
}

export function useAccountProducts(report: Pick<MarketAnalysisReport, 'digitalProducts'> | null | undefined): AccountProducts {
  const custom = useCustomProducts();
  const drafts = useProductDrafts();
  const removed = useRemovedProducts();
  const drafted = drafts.all;
  return useMemo(
    () => gatherProducts({ fromReport: report?.digitalProducts ?? [], custom: custom.products, drafted, removed: removed.ids }),
    [report, custom.products, drafted, removed.ids],
  );
}
