import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Clapperboard,
  Download,
  Image as ImageIcon,
  Loader2,
  PenLine,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { MARKETS } from '@/shared/lib/markets';
import { AwarenessLevel, CreativeFormat, CreativeKind, CreativeStatus } from '@/shared/types/creatives';

/**
 * Génération de visuels et de vidéos publicitaires — feuille de route 4.1, 4.2 et 4.4.
 *
 * - Le niveau de conscience du prospect est obligatoire, et rien n'est
 *   présélectionné : une valeur par défaut serait retenue par inadvertance et
 *   orienterait tout le créatif.
 * - Conformité en deux temps. Le texte du brief est vérifié par le serveur avant
 *   toute génération — c'est un blocage réel. Le contenu visuel, qu'aucun outil
 *   ne relit de façon fiable, doit être regardé puis attesté par l'auteur avant
 *   que le téléchargement soit proposé. Cette seconde étape est volontaire : on
 *   ne peut pas empêcher de copier ce que l'on a le droit de voir.
 */

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS: Record<CreativeKind, number> = { visual: 10 * 60_000, video: 20 * 60_000 };
const FAILED_STATUSES: CreativeStatus['status'][] = ['failed', 'nsfw', 'canceled'];

const AWARENESS_OPTIONS: { value: AwarenessLevel; label: string; hint: string }[] = [
  { value: 'unaware', label: 'Inconscient', hint: "Ne sait pas encore qu'il a un problème : capter l'attention sans parler du produit." },
  { value: 'problem_aware', label: 'Conscient du problème', hint: 'Vit le problème sans connaître de solution : montrer la frustration.' },
  { value: 'solution_aware', label: 'Conscient de la solution', hint: 'Sait que des solutions existent : montrer le bénéfice recherché.' },
  { value: 'product_aware', label: 'Conscient du produit', hint: "Connaît votre produit sans l'avoir acheté : montrer ce qui le distingue." },
  { value: 'most_aware', label: 'Pleinement conscient', hint: "Prêt à acheter : montrer l'offre et un appel à l'action clair." },
];

const FORMAT_OPTIONS: { value: CreativeFormat; label: string }[] = [
  { value: '1:1', label: 'Carré 1:1' },
  { value: '9:16', label: 'Vertical 9:16' },
  { value: '16:9', label: 'Horizontal 16:9' },
];

/** Contrôles que l'auteur atteste avoir faits en regardant le fichier généré. */
const ATTESTATIONS = [
  "Il n'affiche aucune promesse de gain chiffrée ni garantie de résultat.",
  "Il ne met en scène ni avant/après trompeur, ni témoignage inventé.",
  'Tout texte visible est lisible, exact et conforme à mon brief.',
  "Il ne montre ni logo de marque tierce, ni personne réelle identifiable sans son accord.",
];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500';

const PROGRESS_LABELS: Partial<Record<CreativeStatus['status'], string>> = {
  queued: "En file d'attente chez Higgsfield…",
  in_progress: 'Génération en cours…',
};

export const CreativeGeneratorPanel: React.FC = () => {
  const { runWithCredits } = useCreditGate();

  const [kind, setKind] = useState<CreativeKind>('visual');
  const [productName, setProductName] = useState('');
  const [awarenessLevel, setAwarenessLevel] = useState<AwarenessLevel | null>(null);
  const [format, setFormat] = useState<CreativeFormat>('9:16');
  const [market, setMarket] = useState('CI');
  const [audience, setAudience] = useState('');
  const [sceneDescription, setSceneDescription] = useState('');
  const [onScreenText, setOnScreenText] = useState('');
  const [visualStyle, setVisualStyle] = useState('');
  const [duration, setDuration] = useState<5 | 10>(5);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<CreativeStatus['status'] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ requestId: string; mediaType: 'image' | 'video' } | null>(null);
  const [attested, setAttested] = useState<boolean[]>(() => ATTESTATIONS.map(() => false));

  // Remis à false au montage : en mode strict, React démonte et remonte une fois.
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const sceneMax = kind === 'visual' ? 600 : 1500;
  const canSubmit =
    productName.trim().length > 0 && awarenessLevel !== null && sceneDescription.trim().length >= 3 && !isGenerating;
  const allAttested = attested.every(Boolean);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !awarenessLevel) return;

    const generationKind = kind;
    const body = {
      productName: productName.trim(),
      awarenessLevel,
      format,
      market,
      sceneDescription: sceneDescription.trim().slice(0, sceneMax),
      ...(audience.trim() ? { audience: audience.trim() } : {}),
      ...(onScreenText.trim() ? { onScreenText: onScreenText.trim() } : {}),
      ...(visualStyle.trim() ? { visualStyle: visualStyle.trim() } : {}),
      ...(generationKind === 'video' ? { duration } : {}),
    };

    setError(null);
    setResult(null);
    setAttested(ATTESTATIONS.map(() => false));

    try {
      // Points débités seulement si un fichier est produit : échec, refus du
      // filtre de sécurité, abandon ou dépassement de délai ne coûtent rien.
      await runWithCredits(generationKind === 'visual' ? 'image_generation' : 'video_generation', async () => {
        setIsGenerating(true);
        setProgress('queued');

        try {
          const submitted = await fetch(`/api/creatives/${generationKind === 'visual' ? 'visuals' : 'videos'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!submitted.ok) throw await readApiError(submitted, `La demande a échoué (${submitted.status}).`);

          let status = (await submitted.json()) as CreativeStatus;
          const deadline = Date.now() + MAX_WAIT_MS[generationKind];

          while (status.status !== 'completed') {
            if (FAILED_STATUSES.includes(status.status)) {
              throw new ApiError(status.message ?? 'La génération a échoué.');
            }
            if (Date.now() > deadline) {
              throw new ApiError("La génération dépasse le délai d'attente : suivi abandonné. Aucun point n'a été débité.");
            }

            await wait(POLL_INTERVAL_MS);
            if (unmountedRef.current) {
              throw new ApiError("Suivi interrompu : l'écran a été quitté pendant la génération.");
            }

            const polled = await fetch(`/api/creatives/requests/${encodeURIComponent(status.requestId)}`);
            if (!polled.ok) throw await readApiError(polled, `Le suivi a échoué (${polled.status}).`);
            status = (await polled.json()) as CreativeStatus;
            setProgress(status.status);
          }

          if (!status.mediaType) {
            throw new ApiError("La génération s'est terminée sans produire de fichier.");
          }
          setResult({ requestId: status.requestId, mediaType: status.mediaType });
        } finally {
          if (!unmountedRef.current) {
            setIsGenerating(false);
            setProgress(null);
          }
        }
      });
    } catch (caught) {
      if (!unmountedRef.current) setError(toApiError(caught, 'La génération a échoué.'));
    }
  };

  const fileUrl = (disposition: 'inline' | 'attachment') =>
    result ? `/api/creatives/requests/${encodeURIComponent(result.requestId)}/file?disposition=${disposition}` : '';

  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
      active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
    }`;

  return (
    <section className="space-y-5 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-black tracking-tight text-slate-900">Générer un créatif</h2>
          <p className="text-xs text-slate-500">
            Visuel ou vidéo publicitaire, orienté par le niveau de conscience de votre prospect.
          </p>
        </div>
        <div role="tablist" aria-label="Type de créatif" className="inline-flex self-start rounded-xl border border-slate-200 bg-white p-1">
          <button type="button" role="tab" aria-selected={kind === 'visual'} onClick={() => setKind('visual')} className={tabClass(kind === 'visual')} disabled={isGenerating}>
            <ImageIcon className="h-3.5 w-3.5" />
            Visuel
          </button>
          <button type="button" role="tab" aria-selected={kind === 'video'} onClick={() => setKind('video')} className={tabClass(kind === 'video')} disabled={isGenerating}>
            <Clapperboard className="h-3.5 w-3.5" />
            Vidéo
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <fieldset>
          <legend className={labelClass}>
            Niveau de conscience du prospect <span className="text-rose-600">(obligatoire)</span>
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {AWARENESS_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                  awarenessLevel === option.value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="awareness"
                  value={option.value}
                  checked={awarenessLevel === option.value}
                  onChange={() => setAwarenessLevel(option.value)}
                  className="sr-only"
                />
                <span className="block text-xs font-bold text-slate-900">{option.label}</span>
                <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">{option.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={labelClass}>Produit</span>
            <input value={productName} onChange={(e) => setProductName(e.target.value)} maxLength={120} className={fieldClass} />
          </label>

          <label className="block">
            <span className={labelClass}>Marché</span>
            <select value={market} onChange={(e) => setMarket(e.target.value)} className={fieldClass}>
              {MARKETS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend className={labelClass}>Format</legend>
            <div className="flex gap-1.5">
              {FORMAT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={format === option.value}
                  onClick={() => setFormat(option.value)}
                  className={`flex-1 rounded-xl border px-2 py-2.5 text-[11px] font-bold transition-colors ${
                    format === option.value ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block sm:col-span-3">
            <span className={labelClass}>Scène à représenter</span>
            <textarea
              value={sceneDescription}
              onChange={(e) => setSceneDescription(e.target.value)}
              rows={3}
              maxLength={sceneMax}
              placeholder="ex. une commerçante vérifie ses ventes du jour sur son téléphone, au marché, en fin d'après-midi"
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Public visé</span>
            <input value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={300} className={fieldClass} />
          </label>

          <label className="block">
            <span className={labelClass}>Texte à l'écran</span>
            <input
              value={onScreenText}
              onChange={(e) => setOnScreenText(e.target.value)}
              maxLength={120}
              placeholder="facultatif — sinon aucun texte"
              className={fieldClass}
            />
          </label>

          {kind === 'video' ? (
            <fieldset>
              <legend className={labelClass}>Durée</legend>
              <div className="flex gap-1.5">
                {([5, 10] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={duration === value}
                    onClick={() => setDuration(value)}
                    className={`flex-1 rounded-xl border px-2 py-2.5 text-xs font-bold ${
                      duration === value ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    {value} s
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <label className="block">
              <span className={labelClass}>Style visuel</span>
              <input value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)} maxLength={300} className={fieldClass} />
            </label>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-relaxed text-slate-400">
            Le brief passe le vérificateur de conformité avant l'envoi. Le coût en points s'affiche avant
            validation ; restez sur cet écran pendant la génération.
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? 'Génération en cours…' : kind === 'visual' ? 'Générer le visuel' : 'Générer la vidéo'}
          </button>
        </div>
        {!awarenessLevel && (
          <p className="text-[11px] text-rose-600">Choisissez le niveau de conscience du prospect pour continuer.</p>
        )}
      </form>

      {isGenerating && progress && (
        <div role="status" className="flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-600" />
          <p className="text-xs text-indigo-900">{PROGRESS_LABELS[progress] ?? 'Génération en cours…'}</p>
        </div>
      )}

      {error && (
        <div role="alert" className="space-y-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <p className="text-xs leading-relaxed text-rose-900">{error.message}</p>
          </div>
          {error.findings.map((finding, index) => (
            <div key={`${finding.category}-${index}`} className="ml-6 rounded-xl border border-rose-200 bg-white p-3">
              <p className="text-[11px] font-black uppercase tracking-wider text-rose-700">{finding.category}</p>
              <p className="mt-1 text-xs font-semibold text-slate-900">« {finding.matched} »</p>
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-600">
                <PenLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {finding.rewriteHint}
              </p>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 gap-5 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 lg:grid-cols-2">
          <div className="flex items-center justify-center overflow-hidden rounded-xl bg-slate-900/5">
            {result.mediaType === 'video' ? (
              <video src={fileUrl('inline')} controls className="max-h-96 w-full object-contain" />
            ) : (
              <img src={fileUrl('inline')} alt="Créatif généré" className="max-h-96 w-full object-contain" />
            )}
          </div>

          <div className="space-y-3">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-indigo-600" />
              Contrôle avant téléchargement
            </h3>
            <p className="text-xs leading-relaxed text-slate-600">
              Le texte de votre brief a passé la conformité. Le contenu généré, lui, ne peut pas être relu
              automatiquement : regardez-le, puis confirmez chaque point.
            </p>

            <ul className="space-y-2">
              {ATTESTATIONS.map((statement, index) => (
                <li key={statement}>
                  <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-slate-700">
                    <input
                      type="checkbox"
                      checked={attested[index]}
                      onChange={(e) =>
                        setAttested((previous) => previous.map((value, i) => (i === index ? e.target.checked : value)))
                      }
                      className="mt-0.5 h-4 w-4 accent-indigo-600"
                    />
                    {statement}
                  </label>
                </li>
              ))}
            </ul>

            {allAttested ? (
              <a
                href={fileUrl('attachment')}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-600"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger le fichier
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-slate-300 px-4 py-2.5 text-xs font-bold text-white"
              >
                <Download className="h-3.5 w-3.5" />
                Cochez les quatre points pour télécharger
              </button>
            )}

            <p className="text-[11px] leading-relaxed text-slate-400">
              Le fournisseur ne conserve le fichier qu'environ sept jours : téléchargez-le pour le garder.
            </p>
          </div>
        </div>
      )}
    </section>
  );
};
