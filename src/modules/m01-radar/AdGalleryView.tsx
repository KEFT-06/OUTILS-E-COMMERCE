import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  CalendarClock,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  Filter,
  Info,
  LayoutGrid,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { AdvertiserSheet } from '@/modules/m01-radar/AdvertiserSheet';
import { PageHeader } from '@/shared/components/PageHeader';
import { formatDateFr } from '@/shared/lib/formatDate';
import { countryName } from '@server/shared/countries';
import { useAuth } from '@/features/auth/AuthContext';
import { CountryCombobox } from '@/shared/components/CountryCombobox';
import { guessCountryCode } from '@/shared/lib/geo';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { exportSwipeFileCSV, exportSwipeFilePDF } from '@/shared/lib/swipeExport';
import { swipeKey, useSwipeFile } from '@/shared/lib/useSwipeFile';
import type { MarketRate } from '@/shared/types/analysis';
import type { GalleryAd, IngestionScanResponse } from '@/shared/types/ingestion';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { ChartProvenance } from '@/shared/ui/ChartProvenance';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { NoDataState } from '@/shared/ui/NoDataState';
import { RateBadge } from '@/shared/ui/RateBadge';
import { ScoreTracePanel } from '@/shared/ui/ScoreTracePanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Galerie publicitaire filtrable, avec le swipe file et la fiche annonceur.
 *
 * La galerie et le score affiché en tête décrivent la même collecte, reçue en une
 * seule réponse : ce que l'indicateur affirme, la galerie le montre.
 */

type StatusFilter = 'all' | 'active' | 'stopped';

const LIFETIME_FILTERS: { value: string; label: string }[] = [
  { value: '0', label: 'Toutes durées' },
  { value: '7', label: '7 jours et plus' },
  { value: '14', label: '14 jours et plus' },
  { value: '30', label: '30 jours et plus' },
];

interface AdCardProps {
  ad: GalleryAd;
  saved: boolean;
  onToggleSave: () => void;
  onOpenAdvertiser: () => void;
}

function AdCard({ ad, saved, onToggleSave, onOpenAdvertiser }: AdCardProps) {
  const previewUrl = safeHttpUrl(ad.landingPageUrl);

  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpenAdvertiser} className="group min-w-0 rounded-md text-left">
          <span className="block truncate text-sm font-semibold group-hover:text-brand-green-text">{ad.advertiserName}</span>
          <span className="block text-xs text-muted-foreground">Voir la fiche annonceur</span>
        </button>

        <Button
          variant={saved ? 'secondary' : 'outline'}
          size="icon-sm"
          onClick={onToggleSave}
          aria-pressed={saved}
          aria-label={saved ? 'Retirer du swipe file' : 'Ajouter au swipe file'}
          title={saved ? 'Retirer du swipe file' : 'Ajouter au swipe file'}
          className={saved ? 'text-brand-green-text' : undefined}
        >
          {saved ? <BookmarkCheck /> : <Bookmark />}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant={ad.isActive ? 'success' : 'secondary'}>{ad.isActive ? 'Active' : 'Arrêtée'}</Badge>
        <Badge variant="outline" className="tabular-nums">
          <CalendarClock />
          {ad.lifetimeDays.toLocaleString('fr-FR')} j de diffusion
        </Badge>
        {ad.isEstablished && <Badge variant="info">Établie</Badge>}
      </div>

      {ad.creativeBody ? (
        <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">{ad.creativeBody}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">Aucun texte publicitaire collecté.</p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Depuis le {formatDateFr(ad.startedAt)}</span>
        {previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-brand-green-text underline-offset-4 hover:underline"
          >
            Aperçu
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        )}
      </div>
    </article>
  );
}

/** Aperçu statique du format de résultat, affiché avant la première collecte. */
function ResultFormatPreview() {
  return (
    <div className="w-full space-y-3">
      <div className="grid w-full gap-3 sm:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className="space-y-3 rounded-xl border bg-card p-4 text-left">
            <div className="h-3 w-2/3 rounded bg-muted" />
            <div className="flex gap-1.5">
              <div className="h-4 w-12 rounded-full bg-success-soft" />
              <div className="h-4 w-20 rounded-full bg-muted" />
            </div>
            <div className="space-y-1.5">
              <div className="h-2.5 w-full rounded bg-muted" />
              <div className="h-2.5 w-5/6 rounded bg-muted" />
              <div className="h-2.5 w-3/5 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Chaque publicité collectée affichera son annonceur, son statut, sa durée de diffusion, son texte et un lien vers
        la page annoncée.
      </p>
    </div>
  );
}

export function AdGalleryView() {
  const { runWithCredits } = useCreditGate();
  const swipe = useSwipeFile();
  const { account } = useAuth();

  const [niche, setNiche] = useState('');
  const [market, setMarket] = useState(() => account?.country ?? guessCountryCode() ?? 'CI');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [result, setResult] = useState<IngestionScanResponse | null>(null);
  const [scannedNiche, setScannedNiche] = useState('');
  const [scannedMarket, setScannedMarket] = useState('CI');

  const [view, setView] = useState<'gallery' | 'swipe'>('gallery');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [minLifetime, setMinLifetime] = useState('0');

  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [advertiserId, setAdvertiserId] = useState<string | null>(null);

  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  /**
   * Le score collecté est présenté comme un taux pour réutiliser le panneau de
   * traçabilité : même rendu, même règle — la trace affichée est celle que le
   * serveur a produite, jamais un recalcul.
   */
  const scoreRate = useMemo<MarketRate | null>(() => {
    if (!result) return null;

    return {
      key: 'saturation',
      label: 'Intensité concurrentielle mesurée',
      level: result.score.level,
      score: result.score.score,
      description: `Calculé sur ${result.score.sampleSize} publicités actives collectées.`,
      // Non affiché par le panneau : une mesure unique ne fournit aucune tendance.
      trend: 'stable',
      trace: {
        score: result.score.score,
        level: result.score.level,
        methodologyVersion: result.score.methodologyVersion,
        measuredAt: result.score.measuredAt,
        sampleSize: result.score.sampleSize,
        source: result.provenance.isDemonstration ? 'demonstration' : 'live',
        breakdown: result.score.breakdown,
      },
    };
  }, [result]);

  const filteredAds = useMemo(() => {
    if (!result) return [];
    const needle = search.trim().toLocaleLowerCase('fr-FR');
    const lifetime = Number(minLifetime);

    return result.ads.filter((ad) => {
      if (status === 'active' && !ad.isActive) return false;
      if (status === 'stopped' && ad.isActive) return false;
      if (ad.lifetimeDays < lifetime) return false;
      if (!needle) return true;

      return (
        ad.advertiserName.toLocaleLowerCase('fr-FR').includes(needle) ||
        (ad.creativeBody ?? '').toLocaleLowerCase('fr-FR').includes(needle)
      );
    });
  }, [result, search, status, minLifetime]);

  const advertiserAds = useMemo(
    () => (result && advertiserId ? result.ads.filter((ad) => ad.advertiserId === advertiserId) : []),
    [result, advertiserId],
  );

  const resetFilters = () => {
    setSearch('');
    setStatus('all');
    setMinLifetime('0');
  };

  const handleScan = async (event: React.FormEvent) => {
    event.preventDefault();

    const query = niche.trim();
    if (query.length < 2) {
      setScanError("Saisissez une niche d'au moins 2 caractères.");
      return;
    }

    setScanError(null);

    try {
      // Coût annoncé avant la collecte ; points débités seulement si elle aboutit.
      await runWithCredits('ad_gallery_scan', async () => {
        setIsScanning(true);
        try {
          const response = await fetch('/api/ingestion/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ niche: query, market }),
          });

          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
            throw new Error(payload?.error?.message ?? `La collecte a échoué (${response.status}).`);
          }

          const data = (await response.json()) as IngestionScanResponse;
          setResult(data);
          setScannedNiche(query);
          setScannedMarket(market);
          setAdvertiserId(null);
          resetFilters();
          setView('gallery');
        } finally {
          setIsScanning(false);
        }
      });
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'La collecte a échoué.');
    }
  };

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    setExportError(null);

    try {
      if (format === 'csv') {
        await exportSwipeFileCSV(swipe.entries);
      } else {
        await exportSwipeFilePDF(swipe.entries);
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "L'export a échoué.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <Tabs value={view} onValueChange={(value) => setView(value as 'gallery' | 'swipe')} className="gap-6">
      <PageHeader
        eyebrow="Voir"
        title="Galerie publicitaire"
        description="Les publicités diffusées sur une niche, le score qu’elles produisent et la trace de son calcul."
        actions={
          <TabsList>
            <TabsTrigger value="gallery">Galerie</TabsTrigger>
            <TabsTrigger value="swipe">
              Swipe file
              <Badge variant="secondary" className="tabular-nums">
                {swipe.entries.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
        }
      />

      <TabsContent value="gallery" className="space-y-6">
        <Card className="py-5">
          <CardContent>
            <form onSubmit={handleScan} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem_auto] md:items-start">
              <Field>
                <FieldLabel htmlFor="gallery-niche">Niche</FieldLabel>
                <Input
                  id="gallery-niche"
                  value={niche}
                  onChange={(event) => setNiche(event.target.value)}
                  maxLength={200}
                  placeholder="ex. élevage de poulets, énergie solaire, formation Excel"
                />
                <FieldDescription>Le coût en points s’affiche avant toute collecte.</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="gallery-market">Marché</FieldLabel>
                <CountryCombobox id="gallery-market" value={market} onChange={setMarket} />
              </Field>

              <Button type="submit" disabled={isScanning} className="md:mt-[1.625rem]">
                {isScanning ? <Spinner /> : <Search />}
                {isScanning ? 'Collecte en cours…' : 'Collecter les publicités'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {scanError && (
          <Alert variant="danger">
            <AlertTriangle />
            <AlertTitle>La collecte n’a pas abouti</AlertTitle>
            <AlertDescription>{scanError}</AlertDescription>
          </Alert>
        )}

        {isScanning && !result ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Collecte en cours">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <Skeleton key={index} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : !result ? (
          <NoDataState
            icon={LayoutGrid}
            title="Aucune collecte pour le moment"
            reason="Choisissez une niche et un marché : les publicités trouvées s’afficheront ici, avec le score d’intensité concurrentielle calculé sur ce même échantillon."
          >
            <ResultFormatPreview />
          </NoDataState>
        ) : (
          <>
            <Card className="py-5">
              <CardContent className="space-y-1">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      « {scannedNiche} » · {countryName(scannedMarket)}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-display text-3xl font-extrabold tabular-nums">
                        {result.score.score}
                        <span className="text-base font-medium text-muted-foreground"> / 100</span>
                      </span>
                      {scoreRate && (
                        <RateBadge
                          level={scoreRate.level}
                          size="md"
                          inspectLabel={scoreRate.label}
                          onInspect={() => setIsTraceOpen(true)}
                        />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Intensité concurrentielle · touchez le niveau pour le détail du calcul
                    </p>
                  </div>

                  <dl className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-muted/60 px-3 py-2">
                      <dt className="text-xs text-muted-foreground">Publicités</dt>
                      <dd className="font-display text-lg font-extrabold tabular-nums">
                        {(result.provenance.sampleSize ?? result.ads.length).toLocaleString('fr-FR')}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-muted/60 px-3 py-2">
                      <dt className="text-xs text-muted-foreground">Annonceurs</dt>
                      <dd className="inline-flex items-center gap-1 font-display text-lg font-extrabold tabular-nums">
                        <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                        {result.advertiserCount.toLocaleString('fr-FR')}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-muted/60 px-3 py-2">
                      <dt className="text-xs text-muted-foreground">Actives</dt>
                      <dd className="font-display text-lg font-extrabold tabular-nums">
                        {result.signals.activeAds.toLocaleString('fr-FR')}
                      </dd>
                    </div>
                  </dl>
                </div>

                <ChartProvenance provenance={result.provenance} />

                {result.adsTruncated && (
                  <p className="text-xs text-warning">
                    La galerie affiche les {result.ads.length} premières publicités ; le score est calculé sur
                    l’échantillon complet.
                  </p>
                )}
              </CardContent>
            </Card>

            <section aria-label="Filtres" className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Annonceur ou texte publicitaire"
                    aria-label="Rechercher un annonceur ou un texte publicitaire"
                    className="pl-9"
                  />
                </div>
                <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
                  <SelectTrigger aria-label="Statut de diffusion" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Actives et arrêtées</SelectItem>
                    <SelectItem value="active">Actives uniquement</SelectItem>
                    <SelectItem value="stopped">Arrêtées uniquement</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={minLifetime} onValueChange={setMinLifetime}>
                  <SelectTrigger aria-label="Durée de diffusion minimale" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIFETIME_FILTERS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/*
                Format, CTA et budget figurent au cahier des charges. Ils ne sont pas
                proposés tant qu'aucune source ne les fournit : les estimer reviendrait
                à afficher des chiffres inventés.
              */}
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Format, appel à l’action et budget ne sont pas encore filtrables : la source actuelle ne les fournit pas,
                et Smart Creator ne les estime pas.
              </p>
            </section>

            <p className="text-sm text-muted-foreground tabular-nums">
              {filteredAds.length.toLocaleString('fr-FR')} publicité(s) affichée(s) sur{' '}
              {result.ads.length.toLocaleString('fr-FR')}
            </p>

            {filteredAds.length === 0 ? (
              <NoDataState
                icon={Filter}
                title="Aucune publicité ne correspond aux filtres"
                reason="Élargissez la recherche ou réinitialisez les filtres."
                action={{ label: 'Réinitialiser les filtres', onClick: resetFilters }}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredAds.map((ad) => {
                  const key = swipeKey(result.provenance.source, ad.externalId);
                  return (
                    <AdCard
                      key={ad.externalId}
                      ad={ad}
                      saved={swipe.isSaved(key)}
                      onOpenAdvertiser={() => setAdvertiserId(ad.advertiserId)}
                      onToggleSave={() =>
                        swipe.toggle(ad, {
                          niche: scannedNiche,
                          source: result.provenance.source,
                          isDemonstration: result.provenance.isDemonstration,
                          collectedAt: result.provenance.collectedAt,
                        })
                      }
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </TabsContent>

      <TabsContent value="swipe" className="space-y-4">
        <Card className="py-5">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold tabular-nums">
                {swipe.entries.length.toLocaleString('fr-FR')} publicité(s) sauvegardée(s)
              </p>
              <p className="text-sm text-muted-foreground">
                Enregistré sur votre compte : vous le retrouvez sur tous vos appareils.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport('csv')}
                disabled={swipe.entries.length === 0 || exporting !== null}
              >
                {exporting === 'csv' ? <Spinner /> : <FileSpreadsheet />}
                Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport('pdf')}
                disabled={swipe.entries.length === 0 || exporting !== null}
              >
                {exporting === 'pdf' ? <Spinner /> : <FileDown />}
                Export PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmClearOpen(true)}
                disabled={swipe.entries.length === 0}
                className="text-danger hover:text-danger"
              >
                <Trash2 />
                Vider
              </Button>
            </div>
          </CardContent>
        </Card>

        {swipe.writeFailed && (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>Enregistrement impossible</AlertTitle>
            <AlertDescription>
              Votre swipe file n’a pas pu être enregistré sur votre compte (connexion interrompue ?). Il reste affiché dans
              cet onglet : réessayez dans un instant, ou exportez-le avant de fermer.
            </AlertDescription>
          </Alert>
        )}

        {exportError && (
          <Alert variant="danger">
            <AlertTriangle />
            <AlertTitle>L’export a échoué</AlertTitle>
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
        )}

        {swipe.entries.length === 0 ? (
          <NoDataState
            icon={Bookmark}
            title="Votre swipe file est vide"
            reason="Dans la galerie, utilisez le signet d’une publicité pour la conserver ici avec vos notes."
            action={{ label: 'Aller à la galerie', onClick: () => setView('gallery') }}
          />
        ) : (
          <ul className="space-y-3">
            {swipe.entries.map((entry) => (
              <li key={entry.key} className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{entry.ad.advertiserName}</p>
                    <p className="text-xs text-muted-foreground">
                      « {entry.niche} » · {countryName(entry.ad.market)} · {entry.ad.isActive ? 'active' : 'arrêtée'} à
                      la collecte du {formatDateFr(entry.collectedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {entry.isDemonstration && <Badge variant="info">Démonstration</Badge>}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => swipe.remove(entry.key)}
                      aria-label={`Retirer la publicité de ${entry.ad.advertiserName}`}
                      title="Retirer du swipe file"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                {entry.ad.creativeBody && (
                  <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{entry.ad.creativeBody}</p>
                )}

                <Textarea
                  value={entry.note}
                  onChange={(event) => swipe.updateNote(entry.key, event.target.value)}
                  rows={2}
                  maxLength={2000}
                  aria-label={`Note sur la publicité de ${entry.ad.advertiserName}`}
                  placeholder="Ce qui rend cette publicité intéressante : accroche, angle, offre…"
                />
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      <Dialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vider le swipe file ?</DialogTitle>
            <DialogDescription>
              Les {swipe.entries.length} publicités sauvegardées et vos notes seront supprimées de votre compte. Exportez
              d’abord si vous voulez les garder.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Annuler</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                swipe.clear();
                setConfirmClearOpen(false);
              }}
            >
              <Trash2 />
              Tout supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {scoreRate && <ScoreTracePanel rate={scoreRate} open={isTraceOpen} onOpenChange={setIsTraceOpen} />}

      {result && (
        <AdvertiserSheet
          ads={advertiserAds}
          collectedAt={result.provenance.collectedAt}
          isDemonstration={result.provenance.isDemonstration}
          truncated={result.adsTruncated}
          open={advertiserId !== null}
          onOpenChange={(isOpen) => {
            if (!isOpen) setAdvertiserId(null);
          }}
        />
      )}
    </Tabs>
  );
}
