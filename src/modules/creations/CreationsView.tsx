import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlarmClock, BookOpen, Clapperboard, FileText, Languages, PenSquare, Search } from 'lucide-react';
import { useWorkspace } from '@/app/providers/WorkspaceProvider';
import { MyVideosPanel } from '@/modules/creatifs/MyVideosPanel';
import { MyVisualsPanel } from '@/modules/creatifs/MyVisualsPanel';
import type { GuideSummary } from '@/modules/multilingue/guidesApi';
import { BookCover } from '@/shared/components/BookCover';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { formatDateFr } from '@/shared/lib/formatDate';
import { useCustomProducts } from '@/shared/stores/useCustomProducts';
import { useProductCovers } from '@/shared/stores/useProductCovers';
import { useProductDrafts } from '@/shared/stores/useProductDrafts';
import { refreshExpiringVideos } from '@/shared/stores/useExpiringVideos';
import type { DigitalProductIdea } from '@/shared/types/analysis';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';

/**
 * Mes créations : tout ce que le compte a produit, au même endroit.
 *
 * Chaque outil gardait ses productions chez lui — les ouvrages dans le Studio, les guides dans
 * Multilingue, les vidéos sous le générateur. Pour retrouver un texte ou une vidéo, il fallait se
 * souvenir de l'écran qui l'avait fait. Deux onglets ici : les textes, puis les vidéos et visuels.
 *
 * Depuis chaque texte, deux gestes sans rien ressaisir : le traduire, ou en tirer une vidéo.
 * Les vidéos, lourdes, ne sont conservées qu'un temps (selon le palier) : chacune dit ce qu'il
 * lui reste, et un bandeau prévient deux jours avant la suppression.
 */

type Onglet = 'textes' | 'medias';

interface VideoEcheance {
  requestId: string;
  status: string;
  expired: boolean;
  availableUntil: string | null;
}

const DEUX_JOURS_MS = 48 * 3_600_000;

/** Ce qu'un ouvrage donne comme point de départ aux Créatifs : son titre, sa promesse, son public. */
const departVideo = (product: DigitalProductIdea) => ({
  produit: {
    titre: product.title,
    promesse: product.transformationPromise ?? '',
    public: product.targetAudience ?? '',
  },
});

function ProductRow({ product, written, cover }: { product: DigitalProductIdea; written: boolean; cover: string | undefined }) {
  const navigate = useNavigate();
  return (
    <li className="flex gap-4 rounded-lg border bg-card p-3">
      <BookCover title={product.title} subtitle={product.subtitle} label={product.typeName} imageUrl={cover} seed={product.id} className="w-16 shrink-0 self-start sm:w-20" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <p className="line-clamp-2 font-medium" title={product.title}>
            {product.title}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {product.typeName}
            <Badge variant={written ? 'secondary' : 'outline'}>{written ? 'Rédigé' : 'À rédiger'}</Badge>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void navigate('/app/studio', { state: { produit: product.id } })}>
            <PenSquare />
            Ouvrir
          </Button>
          <Button size="sm" variant="outline" onClick={() => void navigate('/app/multilingue', { state: { produit: product.id } })}>
            <Languages />
            Traduire
          </Button>
          <Button size="sm" variant="outline" onClick={() => void navigate('/app/creatifs', { state: departVideo(product) })}>
            <Clapperboard />
            Générer la vidéo associée
          </Button>
        </div>
      </div>
    </li>
  );
}

function GuideRow({ guide }: { guide: GuideSummary }) {
  const navigate = useNavigate();
  const langues = guide.translations.length;
  return (
    <li className="flex items-start gap-4 rounded-lg border bg-card p-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
        <BookOpen className="size-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <p className="line-clamp-2 font-medium" title={guide.title}>
            {guide.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {guide.words.toLocaleString('fr-FR')} mots · {langues === 0 ? 'pas encore traduit' : `${langues} langue${langues > 1 ? 's' : ''}`} · modifié le {formatDateFr(guide.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="secondary">
            <Link to={`/app/multilingue/${guide.id}`}>
              <PenSquare />
              Ouvrir
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to={`/app/multilingue/${guide.id}`} state={{ traduire: true }}>
              <Languages />
              Traduire le guide
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void navigate('/app/creatifs', { state: { produit: { titre: guide.title, promesse: '', public: '' } } })}>
            <Clapperboard />
            Générer la vidéo associée
          </Button>
        </div>
      </div>
    </li>
  );
}

export function CreationsView() {
  const [params, setParams] = useSearchParams();
  const onglet: Onglet = params.get('onglet') === 'medias' ? 'medias' : 'textes';
  const [recherche, setRecherche] = useState('');

  const { currentReport, isLoadingReport } = useWorkspace();
  const custom = useCustomProducts();
  const drafts = useProductDrafts();
  const covers = useProductCovers();
  const [guides, setGuides] = useCachedState<{ guides: GuideSummary[] }>('/api/guides');
  const [videos, setVideos] = useState<VideoEcheance[]>([]);

  useEffect(() => {
    apiRequest<{ guides: GuideSummary[] }>('/api/guides')
      .then(setGuides)
      .catch(() => setGuides((previous) => previous ?? { guides: [] }));
    apiRequest<{ videos: VideoEcheance[] }>('/api/creatives/videos')
      .then(({ videos: liste }) => setVideos(liste))
      .catch(() => undefined);
    // La pastille du menu suit ce que l'écran vient de lire.
    refreshExpiringVideos();
  }, [setGuides]);

  const produits = useMemo(() => {
    const tous = [...custom.products, ...(currentReport?.digitalProducts ?? [])];
    const mot = recherche.trim().toLowerCase();
    return (mot ? tous.filter((product) => product.title.toLowerCase().includes(mot)) : tous).map((product) => ({
      product: drafts.effective(product),
      written: drafts.hasDraft(product.id),
    }));
  }, [custom.products, currentReport, drafts, recherche]);

  const guidesVisibles = useMemo(() => {
    const mot = recherche.trim().toLowerCase();
    return (guides?.guides ?? []).filter((guide) => !mot || guide.title.toLowerCase().includes(mot));
  }, [guides, recherche]);

  // Vidéos encore téléchargeables qui seront supprimées dans les deux jours.
  const bientot = useMemo(
    () => videos.filter((video) => video.status === 'completed' && !video.expired && video.availableUntil !== null && new Date(video.availableUntil).getTime() - Date.now() < DEUX_JOURS_MS),
    [videos],
  );

  const chargementProduits = (isLoadingReport && !currentReport) || custom.status === 'loading';

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Créer" title="Mes créations" description="Tout ce que vous avez produit, au même endroit : vos textes, vos vidéos et vos visuels." />

      {bientot.length > 0 && (
        <Alert variant="warning">
          <AlarmClock />
          <AlertTitle>
            {bientot.length === 1 ? 'Une de vos vidéos sera supprimée' : `${bientot.length} de vos vidéos seront supprimées`} dans moins de 48 heures
          </AlertTitle>
          <AlertDescription>
            <p>Les vidéos ne sont conservées qu’un temps. {bientot.length === 1 ? 'Téléchargez-la sur votre appareil pour la garder.' : 'Téléchargez-les sur votre appareil pour les garder.'}</p>
            {onglet !== 'medias' && (
              <Button variant="link" className="h-auto p-0" onClick={() => setParams({ onglet: 'medias' }, { replace: true })}>
                Voir mes vidéos
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={onglet} onValueChange={(next) => setParams(next === 'medias' ? { onglet: 'medias' } : {}, { replace: true })}>
        {/* Deux colonnes sur téléphone : côte à côte, les deux libellés débordaient de l'écran. */}
        <TabsList className="grid h-auto w-full grid-cols-2 sm:inline-flex sm:w-auto">
          <TabsTrigger value="textes" className="h-auto min-w-0 py-1.5 whitespace-normal">
            <FileText />
            <span>
              <span className="hidden sm:inline">Mes </span>guides et textes
            </span>
          </TabsTrigger>
          <TabsTrigger value="medias" className="h-auto min-w-0 py-1.5 whitespace-normal">
            <Clapperboard />
            <span>
              <span className="hidden sm:inline">Mes </span>vidéos et visuels
            </span>
            {bientot.length > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{bientot.length}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="textes" className="space-y-6">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={recherche} onChange={(change) => setRecherche(change.target.value)} placeholder="Chercher un titre" aria-label="Chercher dans mes textes" className="pl-9" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Ouvrages et produits</CardTitle>
              <CardDescription>Vos ebooks, guides et formations du Studio. Ils restent modifiables et exportables en PDF ou en Word.</CardDescription>
            </CardHeader>
            <CardContent>
              {chargementProduits && produits.length === 0 ? (
                <Skeleton className="h-32 rounded-lg" />
              ) : produits.length === 0 ? (
                <Empty className="border border-dashed py-8">
                  <EmptyHeader>
                    <EmptyTitle>{recherche ? 'Aucun ouvrage ne porte ce titre' : 'Aucun ouvrage pour l’instant'}</EmptyTitle>
                    {!recherche && <EmptyDescription>Créez votre premier produit dans le Studio : il apparaîtra ici.</EmptyDescription>}
                  </EmptyHeader>
                  {!recherche && (
                    <Button asChild>
                      <Link to="/app/studio">
                        <PenSquare />
                        Ouvrir le Studio
                      </Link>
                    </Button>
                  )}
                </Empty>
              ) : (
                <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {produits.map(({ product, written }) => (
                    <ProductRow key={product.id} product={product} written={written} cover={covers[product.id]} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Guides multilingues</CardTitle>
              <CardDescription>Vos guides et leurs traductions.</CardDescription>
            </CardHeader>
            <CardContent>
              {guides === null ? (
                <Skeleton className="h-24 rounded-lg" />
              ) : guidesVisibles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {recherche ? 'Aucun guide ne porte ce titre.' : 'Aucun guide pour l’instant : « Traduire », sur un ouvrage ci-dessus, en crée un.'}
                </p>
              ) : (
                <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {guidesVisibles.map((guide) => (
                    <GuideRow key={guide.id} guide={guide} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2 text-sm">
            <span className="text-muted-foreground">Aussi dans votre compte :</span>
            <Link to="/app/kit-lancement" className="font-medium underline underline-offset-2">
              kits de lancement
            </Link>
            <Link to="/app/pages-produits" className="font-medium underline underline-offset-2">
              pages produits
            </Link>
            <Link to="/app/dossier-pdf" className="font-medium underline underline-offset-2">
              dossiers d’analyse
            </Link>
            <Link to="/app/storybook" className="font-medium underline underline-offset-2">
              contes illustrés
            </Link>
          </div>
        </TabsContent>

        <TabsContent value="medias" className="space-y-6">
          <MyVideosPanel version={0} limit={40} showEmpty />
          <MyVisualsPanel version={0} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
