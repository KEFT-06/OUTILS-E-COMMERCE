import { findStorefront, followableOnRadar } from '@server/shared/storefronts';
import { safeHttpsUrl } from '@/shared/lib/safeUrl';
import { limitWords, shorten } from '@/shared/lib/text';
import type { DigitalProductIdea, MarketAnalysisReport, MetaAdCampaign } from '@/shared/types/analysis';
import type { BeatText, CtaPlatform, KitObjective, LaunchKitDraft, ScriptFormat } from '@/shared/types/launchKit';
import type { FaqItem, SectionRole } from '@/shared/types/productPage';
import type { MarketSearch } from '@/shared/types/radar';
import type { StorybookBrief } from '@/shared/types/storybook';

/**
 * Ce que l'analyse d'une niche permet de proposer dans chaque module, pour que l'auteur n'ait
 * qu'à relire (demande du propriétaire, 11/10/2026).
 *
 * Fonctions pures. Tout vient de l'analyse ou de l'ouvrage : son public, ses difficultés, ses
 * scripts, ses concurrents. Rien n'est inventé — ni chiffre de marché, ni témoignage, ni lien de
 * paiement, ni fait culturel ; ce que l'analyse ne sait pas reste à écrire par l'auteur.
 */

type Report = Pick<MarketAnalysisReport, 'query' | 'nicheName' | 'market' | 'competitors' | 'adCampaigns' | 'audience' | 'pricing' | 'illustrativeImages'>;

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

/**
 * À défaut d'une boutique citée par l'analyse, celle que le marché de la niche désigne : la plus
 * vendeuse de l'index des catalogues, sinon la plus poussée en publicité sur le mur d'espionnage.
 * Une boutique déjà surveillée n'est pas reproposée. Le Radar et l'Espionnage se complètent
 * (demande du propriétaire, 18/10/2026).
 */
export function followableStoreOfMarket(market: Pick<MarketSearch, 'products' | 'advertised'> | null | undefined, watchedHosts: ReadonlySet<string> = new Set()): string {
  const candidates = [...(market?.products ?? []).map((product) => product.storeHost), ...(market?.advertised ?? []).map((offer) => offer.storeHost)];
  return candidates.find((host) => followableOnRadar(host) && !watchedHosts.has(host.toLowerCase())) ?? '';
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
 * changer ; les éléments culturels se proposent d'après le pays d'ancrage (culturalElements.ts).
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
/*  Couverture                                                                 */
/* -------------------------------------------------------------------------- */

/** Ce que la couverture montre, d'après l'ouvrage : son lecteur, déjà arrivé au résultat promis. */
export function coverWishOf(book: { audience?: string | null; promise?: string | null } | null | undefined): string {
  const audience = (book?.audience ?? '').replace(/\s+/g, ' ').trim();
  const promise = (book?.promise ?? '').replace(/\s+/g, ' ').trim();
  if (!promise) return '';
  return shorten(
    audience ? `Une personne du public visé (${audience}) qui vit déjà ce que l’ouvrage promet : ${promise}` : `Une scène qui montre ce que l’ouvrage promet : ${promise}`,
    280,
  );
}

/* -------------------------------------------------------------------------- */
/*  Page produit                                                               */
/* -------------------------------------------------------------------------- */

export interface ProductPageDefaults {
  headlineB: string;
  ctaLabelB: string;
  problem: string;
  /** À qui la page dit franchement que l'offre ne convient pas. */
  notFor: string;
  /** Accès et moyens de paiement conseillés par l'analyse. */
  offerConditions: string;
  /** Les freins de l'acheteur relevés par l'analyse, chacun avec sa réponse. */
  faq: FaqItem[];
  /** Images https connues : la couverture, puis les illustrations de l'analyse, une par section. */
  images: Partial<Record<SectionRole, string>>;
  /** Prix à afficher quand le produit n'en porte pas : celui que propose le simulateur du Studio. */
  price: string;
}

/** Ordre des sections de la page : la première image va à l'accroche. */
const IMAGE_ORDER: readonly SectionRole[] = ['hero', 'problem', 'solution', 'content', 'audience', 'offer', 'faq_cta'];

/** Ce qui sépare un frein de sa réponse dans une objection de l'analyse (« Trop cher : … », « Pas le temps — … »). */
const FREIN_REPONSE = /\s+(?:—|–|->|→)\s+|\s*:\s+/;

/**
 * Les objections de l'analyse en questions-réponses : chacune est écrite « un frein, suivi de la
 * réponse à y apporter ». Une objection sans réponse n'en devient pas une : la FAQ ne répond pas à vide.
 */
export function faqFromObjections(objections: readonly string[] | null | undefined): FaqItem[] {
  return (objections ?? [])
    .flatMap((raw) => {
      const text = raw.replace(/\s+/g, ' ').trim();
      const found = FREIN_REPONSE.exec(text);
      if (!found || found.index < 3) return [];
      const frein = text.slice(0, found.index).replace(/^[«"“\s]+|[»"”\s]+$/g, '').trim();
      const reponse = text.slice(found.index + found[0].length).trim();
      if (!frein || reponse.length < 8) return [];
      return [{ question: shorten(/\?$/.test(frein) ? frein : `« ${frein} »`, 160), answer: shorten(reponse.charAt(0).toUpperCase() + reponse.slice(1), 600) }];
    })
    .slice(0, 4);
}

/**
 * Ce que l'analyse sait de la page de vente d'un ouvrage : la difficulté de son lecteur, et une
 * seconde accroche à comparer à la première. Le lien de paiement, lui, ne se devine pas.
 */
export function productPageDefaultsOf(
  product: Pick<DigitalProductIdea, 'targetProblem' | 'transformationPromise' | 'title'> & Partial<Pick<DigitalProductIdea, 'imageUrl'>>,
  report: Partial<Pick<Report, 'audience' | 'pricing' | 'illustrativeImages'>> | null | undefined,
  options: { fallbackPrice?: string } = {},
): ProductPageDefaults {
  const pains = (report?.audience?.pains ?? []).map((pain) => pain.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const problem = product.targetProblem?.trim() || (pains.length > 0 ? pains.slice(0, 3).map((pain) => `— ${pain}`).join('\n') : '');
  const promise = product.transformationPromise?.replace(/\s+/g, ' ').trim() ?? '';
  return {
    // La variante B compare la promesse au titre : c'est tout l'intérêt d'en avoir deux.
    headlineB: promise && promise !== product.title ? shorten(promise, 160) : '',
    ctaLabelB: 'Je commence maintenant',
    // Les retours à la ligne sont gardés : une difficulté par ligne se relit mieux qu'un bloc.
    problem: problem.replace(/[ \t]+/g, ' ').slice(0, 2000),
    // Une page qui dit à qui elle ne s'adresse pas inspire confiance ; la phrase est à ajuster, pas à écrire.
    notFor: 'Ce produit n’est pas pour vous si vous cherchez un résultat sans effort : il demande de mettre ses étapes en pratique.',
    offerConditions: offerConditionsOf(report?.pricing?.paymentMethods),
    faq: faqFromObjections(report?.audience?.objections),
    images: imagesOf(product.imageUrl, report?.illustrativeImages),
    price: options.fallbackPrice ?? '',
  };
}

/** Accès immédiat (un produit numérique) et moyens de paiement conseillés par l'analyse. */
function offerConditionsOf(methods: readonly string[] | null | undefined): string {
  const moyens = [...new Set((methods ?? []).map((method) => method.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 4);
  return `Accès immédiat après paiement, sur téléphone comme sur ordinateur.${moyens.length > 0 ? ` Paiement : ${moyens.join(', ')}.` : ''}`;
}

/** Une image https par section, sans en répéter aucune : la couverture d'abord, puis les illustrations de l'analyse. */
function imagesOf(cover: string | undefined, illustrations: readonly { url: string }[] | null | undefined): Partial<Record<SectionRole, string>> {
  const urls = [...new Set([cover, ...(illustrations ?? []).map((image) => image.url)].flatMap((url) => (safeHttpsUrl(url) ? [url!] : [])))];
  return Object.fromEntries(IMAGE_ORDER.slice(0, urls.length).map((role, index) => [role, urls[index]!]));
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
