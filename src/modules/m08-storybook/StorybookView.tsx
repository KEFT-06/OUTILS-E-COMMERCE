import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, ExternalLink, Loader2, PenLine, Sparkles } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { MARKETS } from '@/shared/lib/markets';
import { safeHttpUrl } from '@/shared/lib/safeUrl';
import { StorybookBrief, StorybookStatus } from '@/shared/types/storybook';

/**
 * Storybook Africain — feuille de route 3.4.
 *
 * Trois engagements visibles à l'écran, parce qu'ils conditionnent ce que
 * l'auteur peut promettre à ses propres lecteurs :
 *  - la cohérence du personnage d'une page à l'autre n'est pas garantie (3.5) ;
 *  - aucun fait culturel n'est inventé : seuls les éléments fournis par l'auteur
 *    servent de références culturelles précises ;
 *  - le conte généré n'a pas été relu par le vérificateur de conformité.
 */

/** Cadence de sondage recommandée par la documentation Gamma. */
const POLL_INTERVAL_MS = 5_000;
/** Au-delà, le suivi est abandonné et aucun point n'est débité. */
const MAX_WAIT_MS = 10 * 60_000;

interface BriefFinding {
  category: string;
  matched: string;
  rewriteHint: string;
}

class StorybookError extends Error {
  constructor(
    message: string,
    readonly findings: BriefFinding[] = [],
  ) {
    super(message);
    this.name = 'StorybookError';
  }
}

function parseFindings(details: unknown): BriefFinding[] {
  if (!Array.isArray(details)) return [];

  return details.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    return typeof record.category === 'string' &&
      typeof record.matched === 'string' &&
      typeof record.rewriteHint === 'string'
      ? [{ category: record.category, matched: record.matched, rewriteHint: record.rewriteHint }]
      : [];
  });
}

async function readApiError(response: Response, fallback: string): Promise<StorybookError> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string; details?: unknown } }
    | null;
  return new StorybookError(payload?.error?.message ?? fallback, parseFindings(payload?.error?.details));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';

const labelClass = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500';

const INITIAL_BRIEF: StorybookBrief = {
  country: 'CI',
  language: 'fr',
  ageRange: '6-8',
  pages: 8,
  heroName: '',
  heroDescription: '',
  theme: '',
  culturalElements: '',
  visualStyle: '',
};

export const StorybookView: React.FC = () => {
  const { runWithCredits } = useCreditGate();

  const [brief, setBrief] = useState<StorybookBrief>(INITIAL_BRIEF);
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [result, setResult] = useState<StorybookStatus | null>(null);
  const [error, setError] = useState<StorybookError | null>(null);

  // Le suivi s'arrête si l'écran est quitté. Remis à false au montage : en mode
  // strict, React démonte et remonte une fois, ce qui figerait sinon le drapeau.
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!isGenerating) return;
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = setInterval(() => setElapsedSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [isGenerating]);

  const update = <K extends keyof StorybookBrief>(key: K, value: StorybookBrief[K]) =>
    setBrief((previous) => ({ ...previous, [key]: value }));

  const canSubmit = brief.heroName.trim().length > 0 && brief.theme.trim().length >= 3 && !isGenerating;

  const requestBody = () => {
    const optional = (value: string | undefined) => (value && value.trim() ? value.trim() : undefined);
    return {
      country: brief.country,
      language: brief.language,
      ageRange: brief.ageRange,
      pages: brief.pages,
      heroName: brief.heroName.trim(),
      theme: brief.theme.trim(),
      heroDescription: optional(brief.heroDescription),
      culturalElements: optional(brief.culturalElements),
      visualStyle: optional(brief.visualStyle),
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setResult(null);

    try {
      // Points débités seulement quand le conte est terminé : un échec, un abandon
      // ou un dépassement de délai ne coûte rien à l'auteur.
      await runWithCredits('storybook_generation', async () => {
        setIsGenerating(true);
        try {
          const created = await fetch('/api/storybook/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody()),
          });
          if (!created.ok) throw await readApiError(created, `La demande a échoué (${created.status}).`);

          const { generationId } = (await created.json()) as { generationId: string };
          const deadline = Date.now() + MAX_WAIT_MS;

          while (Date.now() < deadline) {
            await wait(POLL_INTERVAL_MS);
            if (unmountedRef.current) {
              throw new StorybookError("Suivi interrompu : l'écran a été quitté pendant la génération.");
            }

            const polled = await fetch(`/api/storybook/generations/${encodeURIComponent(generationId)}`);
            if (!polled.ok) throw await readApiError(polled, `Le suivi a échoué (${polled.status}).`);

            const status = (await polled.json()) as StorybookStatus;
            if (status.status === 'completed') {
              setResult(status);
              return;
            }
            if (status.status === 'failed') {
              throw new StorybookError(status.errorMessage ?? 'La génération a échoué chez Gamma.');
            }
          }

          throw new StorybookError(
            "La génération dépasse 10 minutes : suivi abandonné. Aucun point n'a été débité.",
          );
        } finally {
          if (!unmountedRef.current) setIsGenerating(false);
        }
      });
    } catch (caught) {
      if (unmountedRef.current) return;
      setError(
        caught instanceof StorybookError
          ? caught
          : new StorybookError(caught instanceof Error ? caught.message : 'La génération a échoué.'),
      );
    }
  };

  const storyUrl = safeHttpUrl(result?.gammaUrl);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header>
        <span className="mb-2 inline-block rounded-md border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-700">
          Module 08
        </span>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
          <BookOpen className="h-6 w-6 text-indigo-600" />
          Storybook Africain
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Des contes illustrés ancrés dans le pays de vos lecteurs, générés avec Gamma à partir de
          votre propre brief.
        </p>
      </header>

      <div className="flex items-start gap-2 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-xs leading-relaxed text-amber-900">
          <strong>Cohérence du personnage non garantie.</strong> Gamma ne permet pas de fixer
          l'apparence d'un personnage d'une illustration à l'autre : Smart Creator le demande
          explicitement, sans pouvoir l'imposer. Vérifiez chaque page avant de publier.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className={labelClass}>Pays d'ancrage</span>
            <select value={brief.country} onChange={(e) => update('country', e.target.value)} className={fieldClass}>
              {MARKETS.map((market) => (
                <option key={market.code} value={market.code}>
                  {market.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={labelClass}>Langue</span>
            <select
              value={brief.language}
              onChange={(e) => update('language', e.target.value as StorybookBrief['language'])}
              className={fieldClass}
            >
              <option value="fr">Français</option>
              <option value="en">Anglais</option>
            </select>
          </label>

          <label className="block">
            <span className={labelClass}>Âge des lecteurs</span>
            <select
              value={brief.ageRange}
              onChange={(e) => update('ageRange', e.target.value as StorybookBrief['ageRange'])}
              className={fieldClass}
            >
              <option value="3-5">3 à 5 ans</option>
              <option value="6-8">6 à 8 ans</option>
              <option value="9-12">9 à 12 ans</option>
            </select>
          </label>

          <label className="block">
            <span className={labelClass}>Pages</span>
            <input
              type="number"
              min={4}
              max={20}
              value={brief.pages}
              onChange={(e) => update('pages', Math.min(20, Math.max(4, Number(e.target.value) || 4)))}
              className={fieldClass}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Prénom du personnage principal</span>
            <input value={brief.heroName} onChange={(e) => update('heroName', e.target.value)} maxLength={60} className={fieldClass} />
          </label>

          <label className="block">
            <span className={labelClass}>Description du personnage</span>
            <input
              value={brief.heroDescription}
              onChange={(e) => update('heroDescription', e.target.value)}
              maxLength={300}
              placeholder="âge, apparence, trait de caractère"
              className={fieldClass}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className={labelClass}>Thème et message du conte</span>
            <input
              value={brief.theme}
              onChange={(e) => update('theme', e.target.value)}
              maxLength={300}
              placeholder="ex. le courage d'avouer une erreur"
              className={fieldClass}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className={labelClass}>Éléments culturels à intégrer</span>
            <textarea
              value={brief.culturalElements}
              onChange={(e) => update('culturalElements', e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="prénoms, lieux, plats, fêtes, proverbes que vous connaissez et souhaitez voir figurer"
              className={fieldClass}
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
              Gamma reçoit la consigne de n'utiliser comme références culturelles précises que ces
              éléments, et d'éviter caricatures et stéréotypes. Rien n'est inventé à votre place.
            </span>
          </label>

          <label className="block sm:col-span-2">
            <span className={labelClass}>Style visuel (facultatif)</span>
            <input
              value={brief.visualStyle}
              onChange={(e) => update('visualStyle', e.target.value)}
              maxLength={300}
              placeholder="ex. aquarelle aux couleurs chaudes"
              className={fieldClass}
            />
          </label>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-relaxed text-slate-400">
            Le brief passe le vérificateur de conformité avant l'envoi. Le coût en points s'affiche
            avant validation ; restez sur cet écran pendant la génération.
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? 'Génération en cours…' : 'Générer le conte'}
          </button>
        </div>
      </form>

      {isGenerating && (
        <div role="status" className="flex items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-600" />
          <p className="text-xs text-indigo-900">
            Gamma rédige et illustre le conte — {elapsedSeconds} s écoulées. Comptez en général 1 à 3
            minutes.
          </p>
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

      {result && storyUrl && (
        <section className="space-y-3 rounded-3xl border border-emerald-200 bg-white p-5 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900">Votre conte est prêt</h2>
          <a
            href={storyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-600"
          >
            Ouvrir le conte dans Gamma
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <ul className="space-y-1 text-[11px] leading-relaxed text-slate-500">
            <li>
              Le texte généré n'a pas été relu par le vérificateur de conformité de Smart Creator :
              relisez-le avant toute diffusion.
            </li>
            <li>Vérifiez que le personnage reste reconnaissable d'une page à l'autre.</li>
            <li>Toute personne disposant de ce lien peut consulter le conte.</li>
          </ul>
        </section>
      )}
    </div>
  );
};
