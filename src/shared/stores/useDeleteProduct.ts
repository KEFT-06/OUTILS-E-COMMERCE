import { audioApi } from '@/shared/lib/audio';
import { coversApi } from '@/shared/lib/covers';
import { useCustomProducts } from '@/shared/stores/useCustomProducts';
import { rememberProductCover } from '@/shared/stores/useProductCovers';
import { useProductDrafts } from '@/shared/stores/useProductDrafts';
import { useRemovedProducts } from '@/shared/stores/useRemovedProducts';
import type { DigitalProductIdea } from '@/shared/types/analysis';

/**
 * Ce que le serveur garde pour un ouvrage en dehors de son texte : sa couverture (il peut y en
 * avoir eu plusieurs) et ses pistes audio. Effacé en arrière-plan : la suppression n'attend pas
 * le réseau, et un reste éventuel n'est rattaché à rien de visible.
 */
async function eraseServerSide(productId: string): Promise<void> {
  const covers = async () => {
    for (let passage = 0; passage < 6; passage += 1) {
      const cover = await coversApi.latest('product', productId);
      if (!cover) return;
      await coversApi.remove(cover.id);
    }
  };
  const audio = async () => {
    const tracks = await audioApi.list(productId);
    await Promise.allSettled(tracks.map((track) => audioApi.remove(track.id)));
  };
  await Promise.allSettled([covers(), audio()]);
}

/**
 * Supprime un ouvrage du compte : sa fiche, ses retouches et son texte rédigé, sa couverture et
 * ses pistes audio. Les kits de lancement et les pages produits qui en partaient ne s'affichent
 * plus, puisqu'ils se rangent sous lui.
 */
export function useDeleteProduct(): (product: Pick<DigitalProductIdea, 'id'>) => void {
  const custom = useCustomProducts();
  const drafts = useProductDrafts();
  const removed = useRemovedProducts();

  return (product) => {
    // Créé à la main, tiré d'un texte ou d'une vidéo : il sort de la liste. Issu d'une analyse : il est mis de côté.
    if (custom.products.some((candidate) => candidate.id === product.id)) custom.remove(product.id);
    else removed.add(product.id);
    if (drafts.hasDraft(product.id)) drafts.discardDraft(product.id);
    rememberProductCover(product.id, null);
    void eraseServerSide(product.id);
  };
}
