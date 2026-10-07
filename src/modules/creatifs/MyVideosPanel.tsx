import { useEffect, useState } from 'react';
import { Clapperboard, Download } from 'lucide-react';
import { CREATIVE_ATTESTATIONS } from '@/modules/creatifs/attestations';
import { apiRequest } from '@/shared/lib/api';
import { formatDateFr } from '@/shared/lib/formatDate';
import { pollStatus } from '@/shared/lib/polling';
import type { CreativeStatus } from '@/shared/types/creatives';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Checkbox } from '@/shared/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Label } from '@/shared/ui/label';
import { Spinner } from '@/shared/ui/spinner';

/**
 * « Mes vidéos » : toute vidéo du compte, en cours de rendu ou prête.
 *
 * Une vidéo se rend en une à trois minutes. Son suivi ne vivait que dans l'écran qui l'avait
 * lancée : écran quitté, page rechargée ou connexion coupée, et la vidéo — payée — ne se
 * retrouvait plus nulle part. Elle est ici dès son lancement, se termine sous les yeux de
 * l'auteur ou en son absence, et se lit et se télécharge jusqu'à la date prévue par son palier.
 *
 * Rien n'est affiché tant que le compte n'a lancé aucune vidéo.
 */

interface VideoEntry {
  requestId: string;
  status: 'in_progress' | 'completed';
  createdAt: string;
  durationSeconds: number | null;
  availableUntil: string | null;
  expired: boolean;
}

/** Cadence du suivi d'un rendu en cours. C'est lui qui le fait aboutir, écran d'origine fermé ou non. */
const POLL_MS = 6_000;

const fileUrl = (requestId: string, attachment = false) =>
  `/api/creatives/requests/${encodeURIComponent(requestId)}/file?disposition=${attachment ? 'attachment' : 'inline'}`;

export function MyVideosPanel({ version }: { version: number }) {
  const [videos, setVideos] = useState<VideoEntry[] | null>(null);
  /** Change quand un rendu se termine : la liste est relue. */
  const [settled, setSettled] = useState(0);
  const [downloading, setDownloading] = useState<VideoEntry | null>(null);
  const [attested, setAttested] = useState<boolean[]>(() => CREATIVE_ATTESTATIONS.map(() => false));

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ videos: VideoEntry[] }>('/api/creatives/videos')
      .then((result) => {
        if (!cancelled) setVideos(result.videos);
      })
      .catch(() => {
        // Liste illisible un instant : celle qui est à l'écran reste, la prochaine lecture la remplacera.
      });
    return () => {
      cancelled = true;
    };
  }, [version, settled]);

  // Suivi des rendus en cours : chaque passage interroge le fournisseur et solde la vidéo quand elle aboutit.
  const pending = (videos ?? []).filter((video) => video.status === 'in_progress').map((video) => video.requestId).join(',');
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const timer = setInterval(() => {
      for (const requestId of pending.split(',')) {
        void pollStatus<CreativeStatus>(`/api/creatives/requests/${encodeURIComponent(requestId)}`, 'Le suivi a échoué')
          .then((status) => {
            if (cancelled || !status) return;
            if (status.status !== 'queued' && status.status !== 'in_progress') setSettled((count) => count + 1);
          })
          .catch(() => {
            // Refus définitif (rendu introuvable) : la liste relue ne le proposera plus.
            if (!cancelled) setSettled((count) => count + 1);
          });
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pending]);

  if (!videos || videos.length === 0) return null;

  const allAttested = attested.every(Boolean);

  return (
    <Card id="mes-videos" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clapperboard className="size-4 text-brand-green-text" aria-hidden="true" />
          Mes vidéos
        </CardTitle>
        <CardDescription>
          Vos vidéos, dès leur lancement. Vous pouvez quitter cet écran pendant un rendu : la vidéo vous attend ici.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video) => (
            <li key={video.requestId} className="overflow-hidden rounded-lg border bg-muted/30">
              <div className="flex aspect-video items-center justify-center bg-black/90">
                {video.status === 'in_progress' ? (
                  <p className="flex flex-col items-center gap-2 p-4 text-center text-sm text-white/80" role="status">
                    <Spinner />
                    Rendu en cours, une à trois minutes…
                  </p>
                ) : video.expired ? (
                  <p className="p-4 text-center text-sm text-white/70">Cette vidéo n’est plus conservée.</p>
                ) : (
                  <video src={fileUrl(video.requestId)} controls preload="metadata" playsInline className="size-full object-contain" />
                )}
              </div>
              <div className="flex items-center justify-between gap-2 p-3">
                <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
                  {formatDateFr(video.createdAt)}
                  {video.durationSeconds ? ` · ${video.durationSeconds} s` : ''}
                  {video.status === 'completed' && !video.expired && video.availableUntil && (
                    <span className="block">Téléchargeable jusqu’au {formatDateFr(video.availableUntil)}</span>
                  )}
                </p>
                {video.status === 'completed' && !video.expired && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAttested(CREATIVE_ATTESTATIONS.map(() => false));
                      setDownloading(video);
                    }}
                  >
                    <Download />
                    Télécharger
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>

      {/* Les mêmes engagements d'usage qu'au moment de la génération, avant de remettre le fichier. */}
      <Dialog open={downloading !== null} onOpenChange={(open) => !open && setDownloading(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Avant de télécharger</DialogTitle>
            <DialogDescription>Confirmez que cette vidéo respecte les quatre points ci-dessous.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-3">
            {CREATIVE_ATTESTATIONS.map((statement, index) => (
              <li key={statement} className="flex items-start gap-2.5">
                <Checkbox
                  id={`engagement-video-${index}`}
                  checked={attested[index]}
                  onCheckedChange={(checked) => setAttested((previous) => previous.map((value, rank) => (rank === index ? checked === true : value)))}
                  className="mt-0.5"
                />
                <Label htmlFor={`engagement-video-${index}`} className="text-sm leading-relaxed font-normal">
                  {statement}
                </Label>
              </li>
            ))}
          </ul>
          <DialogFooter>
            {allAttested && downloading ? (
              <Button asChild onClick={() => setDownloading(null)}>
                <a href={fileUrl(downloading.requestId, true)}>
                  <Download />
                  Télécharger le fichier
                </a>
              </Button>
            ) : (
              <Button disabled>
                <Download />
                Cochez les quatre points pour télécharger
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
