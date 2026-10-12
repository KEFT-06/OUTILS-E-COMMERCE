import { findAdFramework } from '@server/shared/adFrameworks';
import { isVideoLanguage } from '@server/shared/languages';
import type { ProductStartInput } from '@/modules/creatifs/adReference';
import type { DigitalProductIdea, MetaAdCampaign } from '@/shared/types/analysis';
import type { AwarenessLevel } from '@/shared/types/creatives';
import type { BeatText, KitObjective, ScriptFormat } from '@/shared/types/launchKit';
import type { StorybookEntry } from '@/shared/types/storybook';
import { shorten } from '@/shared/lib/text';

export { shorten };

/**
 * « Créer une vidéo » depuis un script du dossier, un conte ou un kit de lancement.
 *
 * Demande du propriétaire, 11/10/2026 : chacun de ces écrans doit mener à la création de la vidéo,
 * et l'auteur ne doit rien ressaisir. Chaque fonction rend l'état de navigation à passer aux
 * Créatifs ; le brief s'y ouvre rempli — produit, public, scène, méthode et ses temps, format,
 * langue — et il ne reste qu'à le relire.
 *
 * Fonctions pures : elles ne lisent que ce que l'écran d'origine a sous les yeux, et n'inventent
 * ni chiffre, ni témoignage, ni promesse.
 */

/** Où mène chaque bouton « Créer une vidéo ». */
export const VIDEO_SCREEN = '/app/creatifs';

/** Longueur au-delà de laquelle une ligne ne se lit plus, incrustée dans une vidéo verticale. */
const SCREEN_LINE_MAX = 80;

/**
 * Le texte à l'écran : la première proposition qui tient EN ENTIER. Il est incrusté tel quel dans
 * la vidéo — une promesse coupée y paraîtrait avec ses points de suspension. Mieux vaut aucun
 * texte qu'une phrase amputée.
 */
export function screenLine(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const clean = (candidate ?? '').replace(/\s+/g, ' ').trim();
    if (clean && clean.length <= SCREEN_LINE_MAX) return clean;
  }
  return '';
}

/** Les lignes qui tiennent dans la limite, entières : une scène coupée au milieu d'une phrase ne se relit pas. */
function wholeLines(lines: readonly string[], max: number): string {
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > max) break;
    kept.push(line);
    length += line.length + 1;
  }
  return kept.length > 0 ? kept.join('\n') : shorten(lines[0] ?? '', max);
}

const METHOD_OF_PHASE: Record<string, string> = {
  Attention: 'aida',
  Intérêt: 'aida',
  Désir: 'aida',
  Action: 'aida',
  Problème: 'pas',
  Agitation: 'pas',
  Solution: 'pas',
  Avant: 'bab',
  Après: 'bab',
  Pont: 'bab',
};

/** Ce que la vidéo doit faire au regard du prospect, d'après la méthode du script. Proposé, modifiable. */
const LEVEL_OF_METHOD: Record<string, AwarenessLevel> = {
  aida: 'product_aware',
  pas: 'problem_aware',
  bab: 'solution_aware',
};

/**
 * La méthode d'un script : celle qu'il annonce, sinon celle que ses scènes suivent (un script
 * « UGC » est découpé en temps d'une des trois méthodes).
 */
function methodOf(campaign: MetaAdCampaign): string | null {
  const announced = campaign.framework.toLowerCase();
  if (findAdFramework(announced)) return announced;
  const counts = new Map<string, number>();
  for (const scene of campaign.scenes) {
    const method = METHOD_OF_PHASE[scene.phase];
    if (method) counts.set(method, (counts.get(method) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Un script vidéo du dossier → le brief de sa vidéo.
 *
 * La scène reprend ce que chaque plan montre, dans l'ordre ; les temps de la méthode reprennent ce
 * qui s'y dit. Rien n'est écrit deux fois, et l'auteur retrouve son script là où il s'attend à le lire.
 */
export function videoFromScript(campaign: MetaAdCampaign, context: { audience?: string | null; market?: string | null } = {}): { produit: ProductStartInput } {
  const methode = methodOf(campaign);
  const framework = findAdFramework(methode);
  const said = (label: string) =>
    shorten(
      campaign.scenes
        .filter((scene) => scene.phase === label)
        .map((scene) => scene.spokenVoiceover || scene.onScreenText)
        .filter(Boolean)
        .join(' '),
      200,
    );
  const shown = campaign.scenes
    .filter((scene) => scene.visualDescription.trim())
    .map((scene, index) => `${index + 1}. ${scene.visualDescription.replace(/\s+/g, ' ').trim()}`);

  return {
    produit: {
      titre: shorten(campaign.targetProductTitle, 120),
      promesse: screenLine(campaign.hookHeadline, campaign.scenes[0]?.onScreenText, campaign.metaHeadline),
      public: shorten(context.audience ?? campaign.metaTargeting?.demographics ?? '', 300),
      scene: wholeLines(shown, 1500),
      methode,
      temps: framework ? framework.steps.map((step) => said(step.label)) : [],
      niveau: methode ? (LEVEL_OF_METHOD[methode] ?? null) : null,
      // Le carré n'existe pas en vidéo : un script carré part en vertical, le format des placements visés.
      format: '9:16',
      marche: context.market ?? null,
      origine: `le script ${campaign.framework} de votre dossier`,
    },
  };
}

/**
 * Un conte illustré → la vidéo qui le fait vendre.
 *
 * On montre le livre lui-même : son histoire qui commence, puis le moment où on le lit. La scène
 * ne reprend que le texte du conte, dans sa langue — les consignes d'illustration, rédigées en
 * anglais pour le dessin, n'ont rien à faire sous les yeux de l'auteur. Aucune accroche n'est
 * inventée : les temps de la méthode suivent sa consigne, l'auteur écrit les siens.
 */
export function videoFromStorybook(entry: Pick<StorybookEntry, 'title' | 'story' | 'language' | 'country'>): { produit: ProductStartInput } {
  const opening = entry.story.pages.find((page) => page.text?.trim())?.text.replace(/\s+/g, ' ').trim() ?? '';
  const english = entry.language === 'en';
  const scene = english
    ? [
        `The illustrated children’s book “${entry.title}” opens and its story comes to life.`,
        opening ? `The story begins: ${shorten(opening, 500)}` : '',
        'Then a parent and a child turn the pages of the book together, smiling.',
      ].filter(Boolean)
    : [
        `Le livre illustré pour enfants « ${entry.title} » s’ouvre et son histoire prend vie.`,
        opening ? `L’histoire commence : ${shorten(opening, 500)}` : '',
        'Puis un parent et son enfant tournent ensemble les pages du livre, souriants.',
      ].filter(Boolean);
  return {
    produit: {
      titre: shorten(entry.title, 120),
      promesse: screenLine(entry.title),
      public: english ? 'Parents of young children' : 'Parents de jeunes enfants',
      scene: wholeLines(scene, 1500),
      methode: 'aida',
      temps: [],
      niveau: 'product_aware',
      format: '9:16',
      langue: isVideoLanguage(entry.language) ? entry.language : null,
      marche: /^[A-Z]{2}$/.test(entry.country) ? entry.country : null,
      origine: `votre conte « ${shorten(entry.title, 60)} »`,
    },
  };
}

/** Le temps de la méthode AIDA où se range chaque temps d'un script du kit. */
const AIDA_STEP_OF_BEAT: Record<string, number> = { hook: 0, problem: 1, benefit: 2, solution: 2, content: 2, cta: 3 };

const LEVEL_OF_OBJECTIVE: Record<KitObjective, AwarenessLevel> = {
  sales: 'product_aware',
  leads: 'problem_aware',
  traffic: 'solution_aware',
};

/**
 * Un kit de lancement → la vidéo de son script.
 *
 * Le kit n'écrit pas d'images : il écrit ce qui se dit et ce qui s'affiche. Ses temps deviennent
 * ceux de la méthode ; la scène part de l'ouvrage — pour qui, pour quoi.
 */
export function videoFromKit(
  product: Pick<DigitalProductIdea, 'title' | 'targetAudience' | 'transformationPromise'>,
  kit: { format?: ScriptFormat | null; beats?: Record<string, BeatText> | null; objective: KitObjective; market?: string | null },
): { produit: ProductStartInput } {
  const temps = ['', '', '', ''];
  for (const beat of kit.format?.beats ?? []) {
    const step = AIDA_STEP_OF_BEAT[beat.id];
    const text = kit.beats?.[beat.id];
    const said = (text?.voiceOver || text?.onScreen || '').trim();
    if (step === undefined || !said) continue;
    temps[step] = shorten([temps[step], said].filter(Boolean).join(' '), 200);
  }
  const hook = (kit.beats?.hook?.onScreen || '').trim();
  const audience = product.targetAudience?.trim() ?? '';
  const promise = product.transformationPromise?.trim() ?? '';
  // Le public est déjà dit dans son champ : la scène ne l'accorde pas à un verbe, elle montre un geste.
  const scene = [`Une personne du public visé découvre « ${product.title} » sur son téléphone, dans son quotidien.`, promise].filter(Boolean).join(' ');
  return {
    produit: {
      titre: shorten(product.title, 120),
      promesse: screenLine(hook, promise, product.title),
      public: shorten(audience, 300),
      scene: shorten(scene, 1500),
      methode: 'aida',
      temps: temps.some(Boolean) ? temps : [],
      niveau: LEVEL_OF_OBJECTIVE[kit.objective],
      format: '9:16',
      marche: kit.market && /^[A-Z]{2}$/.test(kit.market) ? kit.market : null,
      origine: 'votre kit de lancement',
    },
  };
}
