import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  CalendarClock,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  Filter,
  LayoutGrid,
  Loader2,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { AdvertiserSheet } from '@/modules/m01-radar/AdvertiserSheet';
import { formatDateFr } from '@/shared/lib/formatDate';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { exportSwipeFileCSV, exportSwipeFilePDF } from '@/shared/lib/swipeExport';
import { swipeKey, useSwipeFile } from '@/shared/lib/useSwipeFile';
import { MarketRate } from '@/shared/types/analysis';
import { GalleryAd, IngestionScanResponse } from '@/shared/types/ingestion';
import { ChartProvenance } from '@/shared/ui/ChartProvenance';
import { NoDataState } from '@/shared/ui/NoDataState';
import { RateBadge } from '@/shared/ui/RateBadge';
import { ScoreTracePanel } from '@/shared/ui/ScoreTracePanel';

/**
 * Galerie publicitaire filtrable — feuille de route 2.2, avec le swipe file (2.3)
 * et la fiche annonceur (2.4).
 *
 * La galerie et le score affiché en tête décrivent la même collecte, reçue en
 * une seule réponse : ce que l'indicateur affirme, la galerie le montre.
 */

/**
 * Marchés acceptés par l'API (`marketSchema`, server/middleware). Le serveur
 * reste l'autorité : un code retiré là-bas sera refusé avec un message explicite.
 */
const MARKETS: { code: string; label: string }[] = [
  { code: 'CI', label: "Côte d'Ivoire" },
  { code: 'SN', label: 'Sénégal' },
  { code: 'CM', label: 'Cameroun' },
  { code: 'BJ', label: 'Bénin' },
  { code: 'TG', label: 'Togo' },
  { code: 'BF', label: 'Burkina Faso' },
  { code: 'ML', label: 'Mali' },
  { code: 'NE', label: 'Niger' },
  { code: 'GN', label: 'Guinée' },
  { code: 'CD', label: 'RD Congo' },
  { code: 'CG', label: 'Congo' },
  { code: 'GA', label: 'Gabon' },
  { code: 'TD', label: 'Tchad' },
  { code: 'MG', label: 'Madagascar' },
  { code: 'MA', label: 'Maroc' },
  { code: 'TN', label: 'Tunisie' },
  { code: 'DZ', label: 'Algérie' },
];

type StatusFilter = 'all' | 'active' | 'stopped';

const LIFETIME_FILTERS: { value: number; label: string }[] = [
  { value: 0, label: 'Toutes durées' },
  { value: 7, label: '7 jours et plus' },
  { value: 14, label: '14 jours et plus' },
  { value: 30, label: '30 jours et plus' },
];

function marketLabel(code: string): string {
  return MARKETS.find((market) => market.code === code)?.label ?? code;
}

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

interface AdCardProps {
  ad: GalleryAd;
  saved: boolean;
  onToggleSave: () => void;
  onOpenAdvertiser: () => void;
}

const AdCard: React.FC<AdCardProps> = ({ ad, saved, onToggleSave, onOpenAdvertiser }) => {
  const previewUrl = safeHttpUrl(ad.landingPageUrl);

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition-colors hover:border-indigo-200">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpenAdvertiser} className="min-w-0 text-left group">
          <p className="truncate text-sm font-bold text-slate-900 group-hover:text-indigo-700">
            {ad.advertiserName}
          </p>
          <p className="text-[10px] font-semibold text-slate-400 group-hover:text-indigo-500">
            Voir la fiche annonceur
          </p>
        </button>

        <button
          type="button"
          onClick={onToggleSave}
          aria-pressed={saved}
          aria-label={saved ? 'Retirer du swipe file' : 'Ajouter au swipe file'}
          title={saved ? 'Retirer du swipe file' : 'Ajouter au swipe file'}
          className={`shrink-0 rounded-lg border p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            saved
              ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
              : 'border-slate-200 text-slate-400 hover:text-indigo-600'
          }`}
        >
          {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
            ad.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {ad.isActive ? 'Active' : 'Arrêtée'}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
          <CalendarClock className="h-3 w-3" />
          {ad.lifetimeDays.toLocaleString('fr-FR')} j de diffusion
        </span>
        {ad.isEstablished && (
          <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">
            Établie
          </span>
        )}
      </div>

      {ad.creativeBody ? (
        <p className="line-clamp-4 text-xs leading-relaxed text-slate-600">{ad.creativeBody}</p>
      ) : (
        <p className="text-xs italic text-slate-400">Aucun texte publicitaire collecté.</p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 text-[10px] text-slate-400">
        <span>Depuis le {formatDateFr(ad.startedAt)}</span>
        {previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Aperçu
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </article>
  );
};

export const AdGalleryView: React.FC = () => {
  const { runWithCredits } = useCreditGate();
  const swipe = useSwipeFile();

  const [niche, setNiche] = useState('');
  const [market, setMarket] = useState('CI');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [result, setResult] = useState<IngestionScanResponse | null>(null);
  const [scannedNiche, setScannedNiche] = useState('');
  const [scannedMarket, setScannedMarket] = useState('CI');

  const [view, setView] = useState<'gallery' | 'swipe'>('gallery');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [minLifetime, setMinLifetime] = useState(0);

  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [advertiserId, setAdvertiserId] = useState<string | null>(null);

  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  /**
   * Le score collecté est présenté comme un taux pour réutiliser le panneau de
   * traçabilité du Lot 1 : même rendu, même règle — la trace affichée est celle
   * que le serveur a produite, jamais un recalcul.
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

    return result.ads.filter((ad) => {
      if (status === 'active' && !ad.isActive) return false;
      if (status === 'stopped' && ad.isActive) return false;
      if (ad.lifetimeDays < minLifetime) return false;
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
    setMinLifetime(0);
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
            const payload = (await response.json().catch(() => null)) as
              | { error?: { message?: string } }
              | null;
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

  const handleClear = () => {
    if (window.confirm(`Supprimer les ${swipe.entries.length} publicités du swipe file ?`)) {
      swipe.clear();
    }
  };

  const tabClass = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
      active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
    }`;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="mb-2 inline-block rounded-md border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-700">
            Module 01
          </span>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
            <LayoutGrid className="h-6 w-6 text-indigo-600" />
            Galerie Publicitaire
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Les publicités diffusées sur une niche, le score qu'elles produisent et la trace de son
            calcul.
          </p>
        </div>

        <div role="tablist" aria-label="Affichage" className="inline-flex self-start rounded-xl border border-slate-200 bg-white p-1">
          <button type="button" role="tab" aria-selected={view === 'gallery'} onClick={() => setView('gallery')} className={tabClass(view === 'gallery')}>
            Galerie
          </button>
          <button type="button" role="tab" aria-selected={view === 'swipe'} onClick={() => setView('swipe')} className={tabClass(view === 'swipe')}>
            Mon swipe file ({swipe.entries.length})
          </button>
        </div>
      </header>

      {view === 'gallery' ? (
        <>
          <form onSubmit={handleScan} className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_auto]">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Niche
                </span>
                <input
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  maxLength={200}
                  placeholder="ex. templates Notion pour freelances"
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Marché
                </span>
                <select value={market} onChange={(e) => setMarket(e.target.value)} className={inputClass}>
                  {MARKETS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={isScanning}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-400 md:w-auto"
                >
                  {isScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {isScanning ? 'Collecte en cours…' : 'Collecter les publicités'}
                </button>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Le coût en points est affiché avant toute collecte.
            </p>
          </form>

          {scanError && (
            <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <p className="text-xs leading-relaxed text-rose-900">{scanError}</p>
            </div>
          )}

          {!result ? (
            <NoDataState
              icon={LayoutGrid}
              title="Aucune collecte pour le moment"
              reason="Lancez une collecte sur une niche et un marché : les publicités trouvées s'afficheront ici, avec le score d'intensité concurrentielle calculé sur ce même échantillon."
            />
          ) : (
            <>
              <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      « {scannedNiche} » · {marketLabel(scannedMarket)}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="font-display text-3xl font-black text-slate-900">
                        {result.score.score}
                        <span className="text-sm font-medium text-slate-400"> / 100</span>
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
                    <p className="text-xs text-slate-500">
                      Intensité concurrentielle · cliquez sur le niveau pour le détail du calcul
                    </p>
                  </div>

                  <dl className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <dt className="text-[10px] font-bold uppercase text-slate-500">Publicités</dt>
                      <dd className="text-lg font-black text-slate-900">
                        {(result.provenance.sampleSize ?? result.ads.length).toLocaleString('fr-FR')}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <dt className="text-[10px] font-bold uppercase text-slate-500">Annonceurs</dt>
                      <dd className="inline-flex items-center gap-1 text-lg font-black text-slate-900">
                        <Users className="h-4 w-4 text-slate-400" />
                        {result.advertiserCount.toLocaleString('fr-FR')}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <dt className="text-[10px] font-bold uppercase text-slate-500">Actives</dt>
                      <dd className="text-lg font-black text-slate-900">
                        {result.signals.activeAds.toLocaleString('fr-FR')}
                      </dd>
                    </div>
                  </dl>
                </div>

                <ChartProvenance provenance={result.provenance} />

                {result.adsTruncated && (
                  <p className="mt-2 text-[11px] text-amber-700">
                    La galerie affiche les {result.ads.length} premières publicités ; le score est
                    calculé sur l'échantillon complet.
                  </p>
                )}
              </section>

              <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <Filter className="h-3.5 w-3.5" />
                  Filtres
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Annonceur ou texte publicitaire"
                    aria-label="Rechercher un annonceur ou un texte publicitaire"
                    className={inputClass}
                  />
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as StatusFilter)}
                    aria-label="Statut de diffusion"
                    className={inputClass}
                  >
                    <option value="all">Actives et arrêtées</option>
                    <option value="active">Actives uniquement</option>
                    <option value="stopped">Arrêtées uniquement</option>
                  </select>
                  <select
                    value={minLifetime}
                    onChange={(e) => setMinLifetime(Number(e.target.value))}
                    aria-label="Durée de diffusion minimale"
                    className={inputClass}
                  >
                    {LIFETIME_FILTERS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/*
                  Format, CTA et budget figurent au cahier des charges. Ils ne sont pas
                  proposés tant qu'aucune source ne les fournit : les estimer reviendrait
                  à afficher des chiffres inventés, ce que le produit s'interdit.
                */}
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Format, appel à l'action et budget estimé ne sont pas encore filtrables : la
                  source de démonstration ne les produit pas, et leur disponibilité dans la Meta Ad
                  Library pour des publicités commerciales reste à vérifier contre l'API réelle (le
                  budget n'y est documenté que pour les publicités politiques ou sociales). Ils ne
                  seront pas estimés.
                </p>
              </section>

              <p className="text-xs text-slate-500">
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
        </>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-slate-900">
                {swipe.entries.length.toLocaleString('fr-FR')} publicité(s) sauvegardée(s)
              </p>
              <p className="text-[11px] text-slate-500">
                Enregistré dans ce navigateur uniquement : la synchronisation avec votre compte attend
                le branchement de la base de données.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleExport('csv')}
                disabled={swipe.entries.length === 0 || exporting !== null}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting === 'csv' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => handleExport('pdf')}
                disabled={swipe.entries.length === 0 || exporting !== null}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                Export PDF
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={swipe.entries.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Vider
              </button>
            </div>
          </div>

          {swipe.writeFailed && (
            <div role="alert" className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs leading-relaxed text-amber-900">
                Ce navigateur refuse l'enregistrement (stockage plein ou navigation privée). Votre swipe
                file sera perdu à la fermeture de l'onglet : exportez-le.
              </p>
            </div>
          )}

          {exportError && (
            <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <p className="text-xs leading-relaxed text-rose-900">{exportError}</p>
            </div>
          )}

          {swipe.entries.length === 0 ? (
            <NoDataState
              icon={Bookmark}
              title="Votre swipe file est vide"
              reason="Dans la galerie, utilisez l'icône signet d'une publicité pour la conserver ici avec vos notes."
              action={{ label: 'Aller à la galerie', onClick: () => setView('gallery') }}
            />
          ) : (
            <ul className="space-y-3">
              {swipe.entries.map((entry) => (
                <li key={entry.key} className="space-y-2.5 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{entry.ad.advertiserName}</p>
                      <p className="text-[11px] text-slate-500">
                        « {entry.niche} » · {marketLabel(entry.ad.market)} ·{' '}
                        {entry.ad.isActive ? 'active' : 'arrêtée'} à la collecte du{' '}
                        {formatDateFr(entry.collectedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {entry.isDemonstration && (
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                          Démonstration
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => swipe.remove(entry.key)}
                        aria-label={`Retirer la publicité de ${entry.ad.advertiserName}`}
                        title="Retirer du swipe file"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-rose-200 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {entry.ad.creativeBody && (
                    <p className="line-clamp-3 text-xs leading-relaxed text-slate-600">{entry.ad.creativeBody}</p>
                  )}

                  <label className="block">
                    <span className="sr-only">Note personnelle</span>
                    <textarea
                      value={entry.note}
                      onChange={(e) => swipe.updateNote(entry.key, e.target.value)}
                      rows={2}
                      maxLength={2000}
                      placeholder="Ce qui rend cette publicité intéressante : accroche, angle, offre…"
                      className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {scoreRate && (
        <ScoreTracePanel rate={scoreRate} open={isTraceOpen} onOpenChange={setIsTraceOpen} />
      )}

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
    </div>
  );
};
