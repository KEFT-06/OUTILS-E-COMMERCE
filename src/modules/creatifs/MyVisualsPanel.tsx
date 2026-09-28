import { useEffect, useState } from 'react';
import { Download, Images } from 'lucide-react';
import { NoDataState } from '@/shared/components/NoDataState';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Spinner } from '@/shared/ui/spinner';

/**
 * « Mes visuels » : les visuels publicitaires du compte, enregistrés sans limite de durée.
 *
 * Ils ne se téléchargeaient qu'au moment de leur création : quitter l'écran suffisait à
 * perdre de vue un visuel payé, pourtant gardé en base. Chaque vignette est servie par
 * l'adresse du fichier, à son seul auteur, et chargée seulement quand elle devient visible.
 */

interface VisualEntry {
  requestId: string;
  prompt: string;
  format: string;
  createdAt: string;
}

interface VisualPage {
  page: number;
  hasMore: boolean;
  visuals: VisualEntry[];
}

const fileUrl = (requestId: string, attachment = false) =>
  `/api/creatives/requests/${encodeURIComponent(requestId)}/file${attachment ? '?disposition=attachment' : ''}`;

export function MyVisualsPanel({ version }: { version: number }) {
  const [visuals, setVisuals] = useState<VisualEntry[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Première page, rechargée à chaque nouveau visuel.
  useEffect(() => {
    let cancelled = false;
    apiRequest<VisualPage>('/api/creatives/visuals?page=1')
      .then((result) => {
        if (cancelled) return;
        setVisuals(result.visuals);
        setHasMore(result.hasMore);
        setPage(1);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'Vos visuels n’ont pas pu être chargés.').message);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const result = await apiRequest<VisualPage>(`/api/creatives/visuals?page=${page + 1}`);
      setVisuals((current) => [...(current ?? []), ...result.visuals]);
      setHasMore(result.hasMore);
      setPage(result.page);
    } catch (caught) {
      setError(toApiError(caught, 'La suite de vos visuels n’a pas pu être chargée.').message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Images className="size-4 text-brand-green-text" aria-hidden="true" />
          Mes visuels
        </CardTitle>
        <CardDescription>Tous les visuels créés sur votre compte, gardés sans limite de durée. Téléchargez-les quand vous voulez.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        {visuals === null && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Chargement de vos visuels…
          </p>
        ) : visuals && visuals.length === 0 ? (
          <NoDataState
            icon={Images}
            title="Aucun visuel pour l’instant"
            reason="Les visuels que vous créez ci-dessus s’ajoutent ici, et y restent : vous pourrez les télécharger à tout moment."
          />
        ) : visuals ? (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {visuals.map((visual) => (
                <li key={visual.requestId} className="overflow-hidden rounded-lg border bg-muted/30">
                  <img
                    src={fileUrl(visual.requestId)}
                    alt={visual.prompt.slice(0, 140)}
                    loading="lazy"
                    className="aspect-square w-full bg-muted object-cover"
                  />
                  <div className="flex items-center justify-between gap-2 p-2">
                    <span className="min-w-0 text-xs text-muted-foreground">
                      {formatDateFr(visual.createdAt)} · {visual.format}
                    </span>
                    <Button asChild variant="ghost" size="icon-sm">
                      <a href={fileUrl(visual.requestId, true)} aria-label={`Télécharger le visuel du ${formatDateFr(visual.createdAt)}`}>
                        <Download />
                      </a>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {hasMore && (
              <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore && <Spinner />}
                Afficher plus
              </Button>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
