import { type ReactNode, useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';

/**
 * Image qui s'agrandit quand on clique dessus.
 *
 * Une vignette ne permet pas de juger un visuel : un texte mal écrit dans l'image, un visage
 * raté, un détail hors sujet ne se voient qu'en grand. Avant, la seule façon de regarder son
 * image était de la télécharger.
 */
export function ZoomableImage({
  src,
  alt,
  className,
  imageClassName,
  downloadHref,
  children,
}: {
  src: string;
  alt: string;
  /** Classes du bouton qui porte la vignette. */
  className?: string;
  imageClassName?: string;
  /** Adresse de téléchargement proposée sous l'image agrandie. */
  downloadHref?: string;
  /** Vignette sur mesure (image composée, par exemple) ; par défaut, l'image elle-même. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('block cursor-zoom-in overflow-hidden outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', className)}
        aria-label={`Agrandir : ${alt}`}
      >
        {children ?? <img src={src} alt={alt} loading="lazy" className={imageClassName} />}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 p-3 sm:max-w-4xl sm:p-4">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">Image agrandie</DialogDescription>
          <img src={src} alt={alt} className="max-h-[80vh] w-full rounded-md bg-muted object-contain" />
          {downloadHref && (
            <Button asChild variant="outline" size="sm" className="justify-self-start">
              <a href={downloadHref} download>
                <Download />
                Télécharger
              </a>
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
