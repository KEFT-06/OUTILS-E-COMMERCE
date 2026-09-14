import { useMemo } from 'react';
import { FlaskConical, History, Info } from 'lucide-react';
import { formatDateFr } from '@/shared/lib/formatDate';
import { cn } from '@/shared/lib/utils';
import type { GalleryAd } from '@/shared/types/ingestion';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

/**
 * Fiche annonceur avec historique de diffusion.
 *
 * L'historique montré est celui que la collecte permet d'établir, et la fiche
 * le dit : suivre un annonceur dans le temps suppose de conserver les collectes
 * successives.
 */
interface AdvertiserSheetProps {
  /** Publicités de cet annonceur dans la collecte courante. */
  ads: GalleryAd[];
  collectedAt: string;
  isDemonstration: boolean;
  /** true ⇒ la galerie n'a reçu qu'une partie de l'échantillon. */
  truncated: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AdvertiserSheet({ ads, collectedAt, isDemonstration, truncated, open, onOpenChange }: AdvertiserSheetProps) {
  const timeline = useMemo(() => [...ads].sort((a, b) => a.startedAt.localeCompare(b.startedAt)), [ads]);

  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  if (!first || !last) return null;

  const activeCount = ads.filter((ad) => ad.isActive).length;
  const establishedCount = ads.filter((ad) => ad.isEstablished).length;
  const averageLifetime = Math.round((ads.reduce((sum, ad) => sum + ad.lifetimeDays, 0) / ads.length) * 10) / 10;
  const longestLifetime = Math.max(1, ...ads.map((ad) => ad.lifetimeDays));

  const stats = [
    { label: 'Publicités', value: ads.length.toLocaleString('fr-FR') },
    { label: 'Actives', value: activeCount.toLocaleString('fr-FR') },
    { label: 'Établies (> 14 j)', value: establishedCount.toLocaleString('fr-FR') },
    { label: 'Diffusion moyenne', value: `${averageLifetime.toLocaleString('fr-FR')} j` },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6">{first.advertiserName}</DialogTitle>
          <DialogDescription>Fiche annonceur · identifiant {first.advertiserId}</DialogDescription>
        </DialogHeader>

        {isDemonstration && (
          <Alert variant="info">
            <FlaskConical />
            <AlertTitle>Annonceur de démonstration</AlertTitle>
            <AlertDescription>Il n’existe pas ; ses publicités sont générées pour exercer l’outil.</AlertDescription>
          </Alert>
        )}

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="mt-0.5 font-display text-lg font-extrabold tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>

        <p className="text-sm text-muted-foreground">
          Première diffusion observée le <strong className="text-foreground">{formatDateFr(first.startedAt)}</strong>,
          plus récente le <strong className="text-foreground">{formatDateFr(last.startedAt)}</strong>.
        </p>

        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <History className="size-3.5" aria-hidden="true" />
            Historique de diffusion
          </h3>

          <ol className="space-y-2">
            {timeline.map((ad) => (
              <li key={ad.externalId} className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium">
                    {formatDateFr(ad.startedAt)}
                    {ad.endedAt && !ad.isActive ? ` → ${formatDateFr(ad.endedAt)}` : ''}
                  </span>
                  <span className={cn('font-semibold tabular-nums', ad.isActive ? 'text-success' : 'text-muted-foreground')}>
                    {ad.isActive ? 'Active' : 'Arrêtée'} · {ad.lifetimeDays.toLocaleString('fr-FR')} j
                  </span>
                </div>

                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className={cn('h-full rounded-full', ad.isActive ? 'bg-brand-green' : 'bg-muted-foreground/50')}
                    style={{ width: `${Math.max(3, (ad.lifetimeDays / longestLifetime) * 100)}%` }}
                  />
                </div>

                {ad.creativeBody && (
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{ad.creativeBody}</p>
                )}
              </li>
            ))}
          </ol>
        </section>

        <p className="flex items-start gap-1.5 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Historique limité à la collecte du {formatDateFr(collectedAt, true)}
          {truncated ? ', et aux publicités reçues par la galerie' : ''}. Suivre un annonceur dans le temps suppose de
          conserver les collectes successives, ce qui attend la base de données.
        </p>
      </DialogContent>
    </Dialog>
  );
}
