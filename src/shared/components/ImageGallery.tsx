import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Carousel, type CarouselApi, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/shared/ui/carousel';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';

export interface GalleryImage {
  src: string;
  alt: string;
  /** Ligne sous l'image : date, format… */
  caption?: string;
  downloadHref?: string;
}

/**
 * Visionneuse : une image en grand, puis les suivantes d'un glissement du doigt, des flèches ou
 * du clavier (← →).
 *
 * Chaque visuel s'ouvrait seul : pour comparer deux visuels, il fallait fermer, revenir à la grille,
 * rouvrir. Seules l'image affichée et ses deux voisines sont chargées : une galerie de quarante
 * visuels n'en télécharge pas quarante à l'ouverture.
 */
export function ImageGallery({ images, openIndex, onClose }: { images: readonly GalleryImage[]; openIndex: number | null; onClose: () => void }) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(openIndex ?? 0);

  // Ouverture sur une autre image : le compteur et les images chargées partent d'elle, pas de la précédente.
  useEffect(() => {
    if (openIndex !== null) setCurrent(openIndex);
  }, [openIndex]);

  useEffect(() => {
    if (!api) return;
    const update = () => setCurrent(api.selectedScrollSnap());
    update();
    api.on('select', update);
    return () => {
      api.off('select', update);
    };
  }, [api]);

  const shown = images[current];
  return (
    <Dialog open={openIndex !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-3 p-3 sm:max-w-4xl sm:p-4">
        <DialogTitle className="sr-only">{shown?.alt ?? 'Visuel'}</DialogTitle>
        <DialogDescription className="sr-only">
          Visuel {current + 1} sur {images.length}. Flèches gauche et droite pour passer au précédent ou au suivant.
        </DialogDescription>
        {openIndex !== null && (
          <Carousel setApi={setApi} opts={{ startIndex: openIndex }} className="w-full">
            <CarouselContent>
              {images.map((image, index) => (
                <CarouselItem key={image.src} className="flex items-center justify-center">
                  {Math.abs(index - current) <= 1 ? (
                    <img src={image.src} alt={image.alt} className="max-h-[70vh] w-full rounded-md bg-muted object-contain" />
                  ) : (
                    <div className="aspect-square max-h-[70vh] w-full rounded-md bg-muted" aria-hidden="true" />
                  )}
                </CarouselItem>
              ))}
            </CarouselContent>
            {images.length > 1 && (
              <>
                <CarouselPrevious className="left-2 bg-background/80 backdrop-blur-sm" />
                <CarouselNext className="right-2 bg-background/80 backdrop-blur-sm" />
              </>
            )}
          </Carousel>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground tabular-nums">
            {images.length > 1 && (
              <span className="font-medium text-foreground">
                {current + 1} / {images.length}
              </span>
            )}
            {shown?.caption && <span>{images.length > 1 ? ' · ' : ''}{shown.caption}</span>}
          </p>
          {shown?.downloadHref && (
            <Button asChild variant="outline" size="sm">
              <a href={shown.downloadHref} download>
                <Download />
                Télécharger
              </a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
