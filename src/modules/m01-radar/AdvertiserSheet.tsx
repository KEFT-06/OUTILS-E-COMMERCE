import React, { useMemo } from 'react';
import { FlaskConical, History, Info } from 'lucide-react';
import { formatDateFr } from '@/shared/lib/formatDate';
import { GalleryAd } from '@/shared/types/ingestion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

/**
 * Fiche annonceur avec historique de diffusion — feuille de route 2.4.
 *
 * L'historique montré est celui que la collecte permet d'établir, et la fiche
 * le dit. Suivre un annonceur dans le temps suppose de conserver les collectes
 * successives ; présenter une seule collecte comme « l'historique » laisserait
 * croire à un suivi qui n'existe pas encore.
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

export const AdvertiserSheet: React.FC<AdvertiserSheetProps> = ({
  ads,
  collectedAt,
  isDemonstration,
  truncated,
  open,
  onOpenChange,
}) => {
  const timeline = useMemo(
    () => [...ads].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [ads],
  );

  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  if (!first || !last) return null;

  const activeCount = ads.filter((ad) => ad.isActive).length;
  const establishedCount = ads.filter((ad) => ad.isEstablished).length;
  const averageLifetime =
    Math.round((ads.reduce((sum, ad) => sum + ad.lifetimeDays, 0) / ads.length) * 10) / 10;
  const longestLifetime = Math.max(1, ...ads.map((ad) => ad.lifetimeDays));

  const stats = [
    { label: 'Publicités', value: ads.length.toLocaleString('fr-FR') },
    { label: 'Actives', value: activeCount.toLocaleString('fr-FR') },
    { label: 'Établies (> 14 j)', value: establishedCount.toLocaleString('fr-FR') },
    { label: 'Diffusion moyenne', value: `${averageLifetime.toLocaleString('fr-FR')} j` },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{first.advertiserName}</DialogTitle>
          <DialogDescription>Fiche annonceur · identifiant {first.advertiserId}</DialogDescription>
        </DialogHeader>

        {isDemonstration && (
          <div className="flex items-center gap-2 rounded-xl border border-indigo-300/70 bg-indigo-50 px-3 py-2">
            <FlaskConical className="h-4 w-4 shrink-0 text-indigo-700" />
            <p className="text-xs leading-relaxed text-indigo-900">
              <strong>Annonceur de démonstration.</strong> Il n'existe pas ; ses publicités sont
              générées pour exercer l'outil.
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {stat.label}
              </dt>
              <dd className="text-lg font-black text-slate-900">{stat.value}</dd>
            </div>
          ))}
        </dl>

        <p className="text-xs text-slate-600">
          Première diffusion observée le <strong>{formatDateFr(first.startedAt)}</strong>, plus
          récente le <strong>{formatDateFr(last.startedAt)}</strong>.
        </p>

        <section>
          <h3 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500">
            <History className="h-3.5 w-3.5" />
            Historique de diffusion
          </h3>

          <ol className="mt-2 space-y-2">
            {timeline.map((ad) => (
              <li key={ad.externalId} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-slate-700">
                    {formatDateFr(ad.startedAt)}
                    {ad.endedAt && !ad.isActive ? ` → ${formatDateFr(ad.endedAt)}` : ''}
                  </span>
                  <span className={ad.isActive ? 'font-bold text-emerald-700' : 'font-bold text-slate-400'}>
                    {ad.isActive ? 'Active' : 'Arrêtée'} · {ad.lifetimeDays.toLocaleString('fr-FR')} j
                  </span>
                </div>

                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${ad.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`}
                    style={{ width: `${Math.max(3, (ad.lifetimeDays / longestLifetime) * 100)}%` }}
                  />
                </div>

                {ad.creativeBody && (
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                    {ad.creativeBody}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>

        <div className="flex items-start gap-1.5 border-t border-slate-200 pt-3">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <p className="text-[11px] leading-relaxed text-slate-500">
            Historique limité à la collecte du {formatDateFr(collectedAt, true)}
            {truncated ? ', et aux publicités reçues par la galerie' : ''}. Suivre un annonceur dans
            le temps suppose de conserver les collectes successives : cela attend le branchement de
            la base de données.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
