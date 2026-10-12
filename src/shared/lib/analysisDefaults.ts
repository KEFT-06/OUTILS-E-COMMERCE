import { findStorefront, followableOnRadar } from '@server/shared/storefronts';
import { limitWords, shorten } from '@/shared/lib/text';
import type { DigitalProductIdea, MarketAnalysisReport, MetaAdCampaign } from '@/shared/types/analysis';
import type { BeatText, CtaPlatform, KitObjective, LaunchKitDraft, ScriptFormat } from '@/shared/types/launchKit';
import type { StorybookBrief } from '@/shared/types/storybook';

/**
 * Ce que l'analyse d'une niche permet de proposer dans chaque module, pour que l'auteur n'ait
 * qu'à relire (demande du propriétaire, 11/10/2026).
 *
 * Fonctions pures. Tout vient de l'analyse ou de l'ouvrage : son public, ses difficultés, ses
 * scripts, ses concurrents. Rien n'est inventé — ni chiffre de marché, ni témoignage, ni lien de
 * paiement, ni fait culturel ; ce que l'analyse ne sait pas reste à écrire par l'auteur.
 */

type Report = Pick<MarketAnalysisReport, 'query' | 'nicheName' | 'market' | 'competitors' | 'adCampaigns' | 'audience'>;

/** Longueur au-delà de laquelle une requête est une phrase, plus un mot-clé. */
const KEYWORD_MAX = 60;

/** Le mot-clé à chercher dans les publicités : ce que l'auteur a lui-même tapé pour analyser sa niche. */
export function spyKeywordOf(report: Pick<Report, 'query' | 'nicheName'> | null | undefined): string {
  const candidates = [report?.query, report?.nicheName].map((text) => (text ?? '').replace(/\s+/g, ' ').trim());
  return candidates.find((text) => text.length >= 2 && text.length <= KEYWORD_MAX) ?? '';
}

/** La boutique d'un concurrent que le radar sait suivre, quand l'analyse en a relevé une. */
export function followableCompetitorOf(report: Pick<Report, 'competitors'> | null | undefined): string {
  for (const competitor of report?.competitors ?? []) {
    const found = findStorefront(competitor.urlOrHandle ?? '');
    if (found && followableOnRadar(found.host)) return found.host;
  }
  return '';
}

/** Le script de l'analyse écrit pour cet ouvrage ; à défaut, le premier. */
export function scriptFor(report: Pick<Report, 'adCampaigns'> | null | undefined, product?: Pick<DigitalProductIdea, 'title'> | null): MetaAdCampaign | null {
  const campaigns = report?.adCampaigns ?? [];
  const title = product?.title.trim().toLowerCase();
  return (title ? campaigns.find((campaign) => campaign.targetProductTitle.trim().toLowerCase() === title) : undefined) ?? campaigns[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Campagnes                                                                  */
/* -------------------------------------------------------------------------- */

/** Objectif de ventes par défaut du simulateur du Studio : les deux écrans partent du même. */
export const DEFAULT_SALES_GOAL = 50;

/**
 * Budget et coût d'acquisition cible d'une campagne : les valeurs par défaut du simulateur de
 * rentabilité du Studio, pour que les deux écrans disent la même chose.
 */
export function campaignNumbersOf(adCostPerSale: number | null | undefined): { budget: string; targetCpa: string } | null {
  if (!adCostPerSale || adCostPerSale <= 0) return null;
  return { budget: String(Math.round(adCostPerSale * DEFAULT_SALES_GOAL)), targetCpa: String(Math.round(adCostPerSale)) };
}

/* -------------------------------------------------------------------------- */
/*  Storybook                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Le brief d'un conte, d'après la niche. Le personnage et le style sont des propositions à
 * changer ; les éléments culturels restent vides — ce sont des faits, et l'outil n'en invente pas.
 */
export function storybookBriefOf(report: Pick<Report, 'nicheName' | 'query'> | null | undefined): Partial<StorybookBrief> {
  const niche = (report?.nicheName || report?.query || '').replace(/\s+/g, ' ').trim();
  return {
    heroName: 'Awa',
    heroDescription: '7 ans, curieuse et courageuse',
    ...(niche ? { theme: shorten(`Une histoire autour de « ${niche} » : la curiosité et la persévérance`, 300) } : {}),
    visualStyle: 'Aquarelle aux couleurs chaudes',
  };
}

/* -------------------------------------------------------------------------- */
/*  Page produit                                                               */
/* -------------------------------------------------------------------------- */

export interface ProductPageDefaults {
  headlineB: string;
  ctaLabelB: string;
  problem: string;
}

/**
 * Ce que l'analyse sait de la page de vente d'un ouvrage : la difficulté de son lecteur, et une
 * seconde accroche à comparer à la première. Le lien de paiement, lui, ne se devine pas.
 */
export function productPageDefaultsOf(product: Pick<DigitalProductIdea, 'targetProblem' | 'transformationPromise' | 'title'>, report: Pick<Report, 'audience'> | null | undefined): ProductPageDefaults {
  const pains = (report?.audience?.pains ?? []).map((pain) => pain.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const problem = product.targetProblem?.trim() || (pains.length > 0 ? pains.slice(0, 3).map((pain) => `— ${pain}`).join('\n') : '');
  const promise = product.transformationPromise?.replace(/\s+/g, ' ').trim() ?? '';
  return {
    // La variante B compare la promesse au titre : c'est tout l'intérêt d'en avoir deux.
    headlineB: promise && promise !== product.title ? shorten(promise, 160) : '',
    ctaLabelB: 'Je commence maintenant',
    // Les retours à la ligne sont gardés : une difficulté par ligne se relit mieux qu'un bloc.
    problem: problem.replace(/[ \t]+/g, ' ').slice(0, 2000),
  };
}

/* -------------------------------------------------------------------------- */
/*  Kit de lancement                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Un kit déjà commencé, avec ce qui y est resté vide complété par la proposition : textes de la
 * première variante, scripts, marché. Rien de ce que l'auteur a écrit n'est touché.
 */
export function completeKitDraft(draft: LaunchKitDraft, proposed: LaunchKitDraft): LaunchKitDraft {
  const [first, ...rest] = draft.copies;
  const base = proposed.copies[0];
  const scripts = { ...draft.scripts };
  for (const [seconds, beats] of Object.entries(proposed.scripts)) {
    const written = scripts[seconds] ?? {};
    scripts[seconds] = Object.fromEntries(
      [...new Set([...Object.keys(beats), ...Object.keys(written)])].map((beatId) => [
        beatId,
        {
          onScreen: written[beatId]?.onScreen.trim() ? written[beatId]!.onScreen : (beats[beatId]?.onScreen ?? ''),
          voiceOver: written[beatId]?.voiceOver.trim() ? written[beatId]!.voiceOver : (beats[beatId]?.voiceOver ?? ''),
        },
      ]),
    );
  }
  return {
    ...draft,
    copies:
      first && base
        ? [{ primaryText: first.primaryText.trim() ? first.primaryText : base.primaryText, headline: first.headline.trim() ? first.headline : base.headline, description: first.description.trim() ? first.description : base.description }, ...rest]
        : draft.copies,
    scripts,
    ctaByMarket: Object.keys(draft.ctaByMarket).length > 0 ? draft.ctaByMarket : proposed.ctaByMarket,
  };
}

const PROBLEM_PHASES = new Set(['Problème', 'Agitation', 'Avant', 'Attention']);
const SOLUTION_PHASES = new Set(['Solution', 'Désir', 'Après', 'Pont', 'Intérêt']);

/** Longueur au-delà de laquelle une ligne ne se lit plus, incrustée dans une vidéo. */
const SCREEN_LINE_MAX = 80;

/** Le texte à l'écran d'un temps : celui du script pour ces phases, sinon la proposition si elle tient en une ligne. */
const screenOf = (campaign: MetaAdCampaign | null, phases: Set<string>, fallback = '') => {
  const written = (campaign?.scenes ?? []).find((scene) => phases.has(scene.phase) && scene.onScreenText.trim())?.onScreenText.trim();
  const short = fallback.replace(/\s+/g, ' ').trim();
  return written || (short.length <= SCREEN_LINE_MAX ? short : '');
};

const voiceOf = (campaign: MetaAdCampaign | null, phases: Set<string>) =>
  (campaign?.scenes ?? [])
    .filter((scene) => phases.has(scene.phase))
    .map((scene) => scene.spokenVoiceover.trim())
    .filter(Boolean)
    .join(' ');

/**
 * Le kit de lancement d'un ouvrage, rempli : un premier texte publicitaire tiré de l'ouvrage, les
 * scripts de chaque durée tirés du script de l'analyse (voix off tenue dans le temps imparti), et
 * le bouton conseillé pour le marché de l'analyse.
 */
export function launchKitDefaultsOf(
  product: Pick<DigitalProductIdea, 'id' | 'title' | 'subtitle' | 'transformationPromise' | 'targetProblem' | 'tableOfContents'>,
  context: {
    report?: Pick<Report, 'adCampaigns'> | null;
    formats?: readonly ScriptFormat[];
    wordsPerSecond?: number;
    platform?: CtaPlatform | null;
    market?: string | null;
    objective?: KitObjective;
  } = {},
): LaunchKitDraft {
  const objective = context.objective ?? 'sales';
  const campaign = scriptFor(context.report, product);
  const promise = product.transformationPromise?.replace(/\s+/g, ' ').trim() ?? '';
  const modules = product.tableOfContents.map((module) => module.title.trim()).filter(Boolean);
  const firstVoice = campaign?.scenes[0]?.spokenVoiceover.trim() ?? '';
  const lastVoice = campaign?.scenes.at(-1)?.spokenVoiceover.trim() ?? '';

  const said: Record<string, { onScreen: string; voiceOver: string }> = {
    hook: { onScreen: campaign?.hookHeadline.trim() || product.title, voiceOver: firstVoice || promise },
    problem: { onScreen: screenOf(campaign, PROBLEM_PHASES, product.targetProblem ?? ''), voiceOver: voiceOf(campaign, PROBLEM_PHASES) || product.targetProblem?.trim() || '' },
    benefit: { onScreen: screenOf(campaign, SOLUTION_PHASES, promise), voiceOver: voiceOf(campaign, SOLUTION_PHASES) || promise },
    solution: { onScreen: screenOf(campaign, SOLUTION_PHASES, promise), voiceOver: voiceOf(campaign, SOLUTION_PHASES) || promise },
    // Le nombre de modules est celui de l'ouvrage : compté, pas estimé.
    content: { onScreen: modules.length > 1 ? `${modules.length} modules` : '', voiceOver: modules.length > 0 ? `Au programme : ${modules.slice(0, 3).join(', ')}.` : '' },
    cta: { onScreen: campaign?.callToAction.trim() || '', voiceOver: campaign && campaign.scenes.length > 1 ? lastVoice : '' },
  };

  const scripts: Record<string, Record<string, BeatText>> = {};
  for (const format of context.formats ?? []) {
    const beats: Record<string, BeatText> = {};
    for (const beat of format.beats) {
      const text = said[beat.id];
      if (!text) continue;
      const maxWords = Math.max(1, Math.round((beat.endSecond - beat.startSecond) * (context.wordsPerSecond ?? 2.5)));
      const filled = { onScreen: shorten(text.onScreen, 300), voiceOver: limitWords(text.voiceOver, maxWords).slice(0, 600) };
      if (filled.onScreen || filled.voiceOver) beats[beat.id] = filled;
    }
    if (Object.keys(beats).length > 0) scripts[String(format.durationSeconds)] = beats;
  }

  const market = context.market && /^[A-Z]{2}$/.test(context.market) ? context.market : null;
  const button = context.platform?.buttons.find((candidate) => candidate.recommendedFor.includes(objective));
  return {
    productId: product.id,
    objective,
    copies: [{ primaryText: promise, headline: shorten(product.title, 120), description: shorten(product.subtitle ?? '', 200) }],
    scripts,
    ctaByMarket: market ? { [market]: button?.id ?? '' } : {},
  };
}
