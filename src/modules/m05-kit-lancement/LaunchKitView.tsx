import React, { useEffect, useState } from 'react';
import { AlertTriangle, Download, ExternalLink, Info, Loader2, Plus, Rocket, Trash2, Wand2 } from 'lucide-react';
import { ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { ComplianceBlockedError } from '@/shared/lib/complianceGate';
import { formatDateFr } from '@/shared/lib/formatDate';
import { KitIncompleteError, OBJECTIVE_LABELS, exportLaunchKit, missingForKit } from '@/shared/lib/launchKit';
import { MARKETS } from '@/shared/lib/markets';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { MAX_COPY_VARIANTS, emptyKitDraft, useLaunchKitDrafts } from '@/shared/lib/useLaunchKitDrafts';
import { useProductDrafts } from '@/shared/lib/useProductDrafts';
import { MarketAnalysisReport } from '@/shared/types/analysis';
import { ReportComplianceVerdict } from '@/shared/types/compliance';
import { AdCopyVariant, BeatText, KitObjective, LaunchKitConfig, LaunchKitDraft } from '@/shared/types/launchKit';
import { ComplianceBlockDialog } from '@/shared/ui/ComplianceBlockDialog';
import { NoDataState } from '@/shared/ui/NoDataState';

/**
 * Kit de lancement — feuille de route 5.1.
 *
 * Aucun fournisseur de texte n'est branché : le kit structure, pré-remplit
 * depuis le produit réel et contrôle, mais n'écrit pas à la place de l'auteur.
 * L'ancien placeholder promettait une génération « basée sur 12 méthodes de
 * copywriting » que rien n'implémentait.
 */

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500';

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export const LaunchKitView: React.FC<{ report: MarketAnalysisReport }> = ({ report }) => {
  const productDrafts = useProductDrafts();
  const kitDrafts = useLaunchKitDrafts();

  const [config, setConfig] = useState<LaunchKitConfig | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [productId, setProductId] = useState(report.digitalProducts[0]?.id ?? '');
  const [duration, setDuration] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [blockedVerdict, setBlockedVerdict] = useState<ReportComplianceVerdict | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/launch-kit/config')
      .then(async (response) => {
        if (!response.ok) throw await readApiError(response, `Le kit n'a pas pu être chargé (${response.status}).`);
        return (await response.json()) as LaunchKitConfig;
      })
      .then((payload) => {
        if (cancelled) return;
        setConfig(payload);
        setDuration((current) => current ?? payload.scriptFormats[0]?.durationSeconds ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoadError(toApiError(caught, "Le kit n'a pas pu être chargé."));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const baseProduct =
    report.digitalProducts.find((candidate) => candidate.id === productId) ?? report.digitalProducts[0];

  if (!baseProduct) {
    return (
      <NoDataState
        icon={Rocket}
        title="Aucun produit dans ce rapport"
        reason="Le kit de lancement part d'un produit du Studio. Ce rapport n'en contient pas encore."
      />
    );
  }

  const product = productDrafts.effective(baseProduct);
  const draft = kitDrafts.get(product.id) ?? emptyKitDraft(product.id);
  const update = (changes: Partial<LaunchKitDraft>) => kitDrafts.save({ ...draft, ...changes });

  const updateCopy = (index: number, changes: Partial<AdCopyVariant>) =>
    update({ copies: draft.copies.map((copy, i) => (i === index ? { ...copy, ...changes } : copy)) });

  const updateBeat = (seconds: number, beatId: string, changes: Partial<BeatText>) => {
    const key = String(seconds);
    const beats = draft.scripts[key] ?? {};
    const current = beats[beatId] ?? { onScreen: '', voiceOver: '' };
    update({ scripts: { ...draft.scripts, [key]: { ...beats, [beatId]: { ...current, ...changes } } } });
  };

  /** Pré-remplit la première variante depuis le produit réel, sans écraser une saisie. */
  const prefillFromProduct = () => {
    const [first, ...rest] = draft.copies;
    if (!first) return;
    update({
      copies: [
        {
          primaryText: first.primaryText || product.transformationPromise,
          headline: first.headline || product.title,
          description: first.description || product.subtitle,
        },
        ...rest,
      ],
    });
  };

  const handleExport = async () => {
    if (!config) return;
    setIsExporting(true);
    setExportError(null);

    try {
      await exportLaunchKit(product, draft, config);
    } catch (error) {
      if (error instanceof ComplianceBlockedError) {
        setBlockedVerdict(error.verdict);
        return;
      }
      if (error instanceof KitIncompleteError) {
        setExportError(error.missing.join(' '));
        return;
      }
      setExportError(error instanceof Error ? error.message : "L'export a échoué.");
    } finally {
      setIsExporting(false);
    }
  };

  const platform = config?.ctaPlatforms[0];
  const format = config?.scriptFormats.find((candidate) => candidate.durationSeconds === duration);
  const missing = missingForKit(draft);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="mb-2 inline-block rounded-md border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-700">
            Module 05
          </span>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
            <Rocket className="h-6 w-6 text-indigo-600" />
            Kit de Lancement
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Textes publicitaires, scripts 15, 30 et 60 secondes, et boutons d'appel à l'action par marché.
          </p>
        </div>
        <label className="block sm:w-72">
          <span className={labelClass}>Produit</span>
          <select value={baseProduct.id} onChange={(e) => setProductId(e.target.value)} className={fieldClass}>
            {report.digitalProducts.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {productDrafts.effective(candidate).title}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <p className="text-xs leading-relaxed text-slate-600">
          Aucun fournisseur de rédaction n'est branché : le kit vous guide et contrôle vos textes, il ne les écrit pas.
          Le pré-remplissage reprend uniquement les données de votre produit.
        </p>
      </div>

      {loadError && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <p className="text-xs text-rose-900">{loadError.message}</p>
        </div>
      )}

      {config?.valuesStatus && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-relaxed text-amber-900">{config.valuesStatus}</p>
        </div>
      )}

      <section className="space-y-3 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <fieldset>
          <legend className={labelClass}>Objectif de la campagne</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(OBJECTIVE_LABELS) as KitObjective[]).map((objective) => (
              <button
                key={objective}
                type="button"
                aria-pressed={draft.objective === objective}
                onClick={() => update({ objective })}
                className={`rounded-xl border px-3 py-2 text-xs font-bold ${
                  draft.objective === objective ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'
                }`}
              >
                {OBJECTIVE_LABELS[objective]}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="space-y-4 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-bold text-slate-900">Textes publicitaires</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={prefillFromProduct}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:border-indigo-300"
            >
              <Wand2 className="h-3 w-3" />
              Pré-remplir depuis le produit
            </button>
            {draft.copies.length < MAX_COPY_VARIANTS && (
              <button
                type="button"
                onClick={() => update({ copies: [...draft.copies, { primaryText: '', headline: '', description: '' }] })}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:border-indigo-300"
              >
                <Plus className="h-3 w-3" />
                Variante
              </button>
            )}
          </div>
        </div>

        {draft.copies.map((copy, index) => (
          <div key={index} className="space-y-2 rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-black uppercase tracking-wider text-indigo-600">Variante {index + 1}</p>
              {draft.copies.length > 1 && (
                <button
                  type="button"
                  onClick={() => update({ copies: draft.copies.filter((_copy, i) => i !== index) })}
                  aria-label={`Supprimer la variante ${index + 1}`}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <label className="block">
              <span className={labelClass}>Texte principal</span>
              <textarea value={copy.primaryText} onChange={(e) => updateCopy(index, { primaryText: e.target.value })} rows={3} maxLength={2000} className={fieldClass} />
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Titre</span>
                <input value={copy.headline} onChange={(e) => updateCopy(index, { headline: e.target.value })} maxLength={120} className={fieldClass} />
              </label>
              <label className="block">
                <span className={labelClass}>Description</span>
                <input value={copy.description} onChange={(e) => updateCopy(index, { description: e.target.value })} maxLength={200} className={fieldClass} />
              </label>
            </div>
          </div>
        ))}
      </section>

      {config && format && (
        <section className="space-y-4 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-bold text-slate-900">Scripts vidéo</h2>
            <div className="inline-flex rounded-xl border border-slate-200 p-1">
              {config.scriptFormats.map((candidate) => (
                <button
                  key={candidate.durationSeconds}
                  type="button"
                  aria-pressed={duration === candidate.durationSeconds}
                  onClick={() => setDuration(candidate.durationSeconds)}
                  className={`rounded-lg px-3 py-1 text-xs font-bold ${
                    duration === candidate.durationSeconds ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  {candidate.label}
                </button>
              ))}
            </div>
          </div>

          {format.beats.map((beat) => {
            const text = draft.scripts[String(format.durationSeconds)]?.[beat.id] ?? { onScreen: '', voiceOver: '' };
            const maxWords = Math.round((beat.endSecond - beat.startSecond) * config.voiceOverWordsPerSecond);
            const words = wordCount(text.voiceOver);
            return (
              <div key={beat.id} className="space-y-2 rounded-2xl border border-slate-200 p-4">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wider text-indigo-600">
                    {beat.startSecond}–{beat.endSecond} s · {beat.label}
                  </p>
                  <p className="text-xs text-slate-500">{beat.purpose}</p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className={labelClass}>Texte à l'écran</span>
                    <textarea
                      value={text.onScreen}
                      onChange={(e) => updateBeat(format.durationSeconds, beat.id, { onScreen: e.target.value })}
                      rows={2}
                      maxLength={300}
                      className={fieldClass}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Voix off</span>
                    <textarea
                      value={text.voiceOver}
                      onChange={(e) => updateBeat(format.durationSeconds, beat.id, { voiceOver: e.target.value })}
                      rows={2}
                      maxLength={600}
                      className={fieldClass}
                    />
                    <span className={`mt-1 block text-[11px] ${words > maxWords ? 'text-amber-700' : 'text-slate-400'}`}>
                      {words} mot(s) · repère : {maxWords} au plus pour {beat.endSecond - beat.startSecond} s
                    </span>
                  </label>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {platform && (
        <section className="space-y-3 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Bouton d'appel à l'action par marché</h2>
            <p className="text-[11px] text-slate-500">
              Noms officiels {platform.label}, vérifiés le {formatDateFr(platform.checkedAt)}.{' '}
              {safeHttpUrl(platform.source) && (
                <a
                  href={safeHttpUrl(platform.source) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-semibold text-indigo-600"
                >
                  source
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {MARKETS.map((market) => {
              const recommended = platform.buttons.filter((button) => button.recommendedFor.includes(draft.objective));
              const others = platform.buttons.filter((button) => !button.recommendedFor.includes(draft.objective));
              return (
                <label key={market.code} className="block rounded-xl border border-slate-200 p-2.5">
                  <span className="mb-1 block text-xs font-semibold text-slate-700">{market.label}</span>
                  <select
                    value={draft.ctaByMarket[market.code] ?? ''}
                    onChange={(e) => update({ ctaByMarket: { ...draft.ctaByMarket, [market.code]: e.target.value } })}
                    className={fieldClass}
                  >
                    <option value="">— non concerné —</option>
                    <optgroup label={`Recommandés pour : ${OBJECTIVE_LABELS[draft.objective]}`}>
                      {recommended.map((button) => (
                        <option key={button.id} value={button.id}>
                          {button.officialName}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Autres boutons">
                      {others.map((button) => (
                        <option key={button.id} value={button.id}>
                          {button.officialName}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
        {missing.map((item) => (
          <p key={item} className="flex items-start gap-1.5 text-xs text-rose-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {item}
          </p>
        ))}
        <button
          type="button"
          onClick={handleExport}
          disabled={!config || missing.length > 0 || isExporting}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Télécharger le kit (texte)
        </button>
        {exportError && <p className="text-xs text-rose-700">{exportError}</p>}
        <p className="text-[11px] leading-relaxed text-slate-400">
          Tous les textes et scripts passent le vérificateur de conformité avant le téléchargement. Saisies conservées
          dans ce navigateur{kitDrafts.writeFailed ? ' — ENREGISTREMENT REFUSÉ par le navigateur : exportez avant de fermer' : ''}.
        </p>
      </section>

      <ComplianceBlockDialog
        verdict={blockedVerdict}
        open={blockedVerdict !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setBlockedVerdict(null);
        }}
      />
    </div>
  );
};
