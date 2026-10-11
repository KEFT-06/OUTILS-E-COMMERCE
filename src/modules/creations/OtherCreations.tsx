import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart3, BookImage, Download, FileText, Image as ImageIcon, PenSquare } from 'lucide-react';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import type { GuideSummary } from '@/modules/multilingue/guidesApi';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { type CoverView, coversApi } from '@/shared/lib/covers';
import { formatDateFr } from '@/shared/lib/formatDate';
import type { DigitalProductIdea } from '@/shared/types/analysis';
import { type StorybookEntry, storybookPdfPath, storybookPicturePath } from '@/shared/types/storybook';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * Le reste de ce que le compte a produit : ses rapports d'analyse, ses contes illustrés et ses
 * couvertures.
 *
 * Demande du propriétaire, 11/10/2026 : « tout ebook, rapport, storybook, visuel, vidéo,
 * couverture créé par l'utilisateur doit aller à Mes créations ». L'écran listait les ouvrages,
 * les guides, les vidéos et les visuels ; les rapports et les contes n'y avaient qu'un lien vers
 * leur module, et les couvertures n'y étaient pas.
 */

const contient = (titre: string, mot: string) => !mot || titre.toLowerCase().includes(mot);

/** Rapports d'analyse du compte : chacun s'ouvre dans l'Analyse ou dans son dossier PDF. */
export function ReportsCard({ recherche }: { recherche: string }) {
  const { reports, currentReport, selectReport } = useWorkspace();
  const navigate = useNavigate();
  const mot = recherche.trim().toLowerCase();
  const visibles = reports.filter((report) => contient(`${report.nicheName} ${report.query}`, mot));
  const ouvrir = (id: string, ecran: string) => {
    if (currentReport?.id !== id) selectReport(id);
    void navigate(ecran);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rapports d’analyse</CardTitle>
        <CardDescription>Chaque niche que vous avez fait analyser : son étude, et son dossier à exporter en PDF.</CardDescription>
      </CardHeader>
      <CardContent>
        {visibles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {mot ? 'Aucun rapport ne porte ce titre.' : 'Aucun rapport pour l’instant : « Analyser une niche », en haut de l’écran, crée le premier.'}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {visibles.map((report) => (
              <li key={report.id} className="flex items-start gap-4 rounded-lg border bg-card p-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                  <BarChart3 className="size-5 text-muted-foreground" aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-medium" title={report.nicheName}>
                      {report.nicheName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {report.market ? `${report.market} · ` : ''}analysé le {formatDateFr(report.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => ouvrir(report.id, '/app/analyse')}>
                      <PenSquare />
                      Ouvrir l’analyse
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => ouvrir(report.id, '/app/dossier-pdf')}>
                      <FileText />
                      Dossier PDF
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const ETAT_CONTE: Record<StorybookEntry['status'], { label: string; variant: 'success' | 'info' | 'danger' }> = {
  completed: { label: 'Prêt', variant: 'success' },
  pending: { label: 'En cours', variant: 'info' },
  failed: { label: 'Non abouti', variant: 'danger' },
};

/** La couverture d'un conte ; une vignette neutre tant qu'elle n'existe pas, ou si l'image ne se charge pas. */
function StorybookThumbnail({ entry }: { entry: StorybookEntry }) {
  const [illisible, setIllisible] = useState(false);
  if (!entry.pictures.includes(0) || illisible) {
    return (
      <span className="flex h-20 w-16 shrink-0 items-center justify-center rounded-md bg-muted">
        <BookImage className="size-5 text-muted-foreground" aria-hidden="true" />
      </span>
    );
  }
  return <img src={storybookPicturePath(entry.id, 0)} alt="" loading="lazy" onError={() => setIllisible(true)} className="h-20 w-16 shrink-0 rounded-md object-cover" />;
}

/** Contes illustrés du compte, avec leur couverture quand elle est prête. */
export function StorybooksCard({ recherche }: { recherche: string }) {
  const [entries, setEntries] = useCachedState<StorybookEntry[]>('/api/storybook/books');
  useEffect(() => {
    apiRequest<{ storybooks: StorybookEntry[] }>('/api/storybook/books')
      .then(({ storybooks }) => setEntries(storybooks))
      // Lecture ratée : on garde ce qu'on savait, sans afficher une liste vide à la place.
      .catch(() => undefined);
  }, [setEntries]);
  const mot = recherche.trim().toLowerCase();
  const visibles = (entries ?? []).filter((entry) => contient(entry.title, mot));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contes illustrés</CardTitle>
        <CardDescription>Vos storybooks : l’histoire, ses illustrations et son PDF.</CardDescription>
      </CardHeader>
      <CardContent>
        {entries === null ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : visibles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {mot ? 'Aucun conte ne porte ce titre.' : (
              <>
                Aucun conte pour l’instant :{' '}
                <Link to="/app/storybook" className="font-medium text-foreground underline underline-offset-2">
                  le Storybook illustré
                </Link>{' '}
                en crée un à partir d’un prénom et d’un thème.
              </>
            )}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {visibles.map((entry) => {
              const etat = ETAT_CONTE[entry.status];
              return (
                <li key={entry.id} className="flex gap-4 rounded-lg border bg-card p-3">
                  <StorybookThumbnail entry={entry} />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="min-w-0">
                      <p className="line-clamp-2 font-medium" title={entry.title}>
                        {entry.title}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {entry.pages} pages · créé le {formatDateFr(entry.createdAt)}
                        <Badge variant={etat.variant}>{etat.label}</Badge>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="secondary">
                        <Link to="/app/storybook">
                          <PenSquare />
                          Ouvrir
                        </Link>
                      </Button>
                      {entry.status === 'completed' && (
                        <Button asChild size="sm" variant="outline">
                          <a href={storybookPdfPath(entry.id)} download>
                            <Download />
                            Télécharger le PDF
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Couvertures générées pour les ouvrages et les guides du compte. */
export function CoversCard({ products, guides }: { products: readonly DigitalProductIdea[]; guides: readonly GuideSummary[] }) {
  const [covers, setCovers] = useState<CoverView[] | null>(null);
  useEffect(() => {
    let quitte = false;
    Promise.all([coversApi.mine('product'), coversApi.mine('guide')])
      .then(([ouvrages, traductions]) => {
        if (!quitte) setCovers([...ouvrages, ...traductions]);
      })
      .catch(() => undefined);
    return () => {
      quitte = true;
    };
  }, []);
  const titres = useMemo(() => new Map<string, string>([...products.map((product) => [product.id, product.title] as const), ...guides.map((guide) => [guide.id, guide.title] as const)]), [products, guides]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Couvertures</CardTitle>
        <CardDescription>Les couvertures générées pour vos ouvrages et vos guides, à télécharger telles quelles.</CardDescription>
      </CardHeader>
      <CardContent>
        {covers === null ? (
          <Skeleton className="h-40 rounded-lg" />
        ) : covers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune couverture pour l’instant : « Générer la couverture », sur la fiche d’un ouvrage du{' '}
            <Link to="/app/studio" className="font-medium text-foreground underline underline-offset-2">
              Studio
            </Link>
            , en crée une.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {covers.map((cover) => {
              const titre = titres.get(cover.subjectId) ?? (cover.subject === 'guide' ? 'Guide' : 'Ouvrage');
              return (
                <li key={cover.id} className="space-y-2">
                  <img src={coversApi.imageUrl(cover)} alt={`Couverture de « ${titre} »`} loading="lazy" className="aspect-[2/3] w-full rounded-md border bg-muted object-contain" />
                  <p className="line-clamp-2 text-sm font-medium" title={titre}>
                    {titre}
                  </p>
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <a href={coversApi.imageUrl(cover)} download={`couverture-${cover.subjectId}`}>
                      <ImageIcon />
                      Télécharger
                    </a>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
