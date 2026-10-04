import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { env, isProd } from '@server/env';
import { AppError, marketSchema } from '@server/middleware';
import { type FalQueueStatus, getFalGeneration } from '@server/services/fal';
import {
  VEO_FORMATS,
  type VeoGeneration,
  fetchVeoMedia,
  getVeoGeneration,
  submitVeoExtension,
  submitVeoGeneration,
} from '@server/services/veo';
import { cloudflareImagesConfigured } from '@server/services/ai/cloudflareImage';
import { geminiImagesConfigured } from '@server/services/ai/geminiImage';
import { fetchArchivedVideo } from '@server/services/creatives/archive';
import { AD_FRAMEWORK_IDS, findAdFramework } from '@server/shared/adFrameworks';
import { countryName } from '@server/shared/countries';

/**
 * Créatifs publicitaires : visuels et vidéos — feuille de route 4.1, 4.2 et 4.4.
 *
 * - Le niveau de conscience du prospect est obligatoire dans le schéma : il
 *   oriente toute la direction créative, et un créatif sans cible de conscience
 *   parle à tout le monde, donc à personne.
 * - Les trois formats du cahier des charges (1:1, 9:16, 16:9) sont ceux que les
 *   deux modèles retenus acceptent tous : Soul pour l'image, Kling 2.5 Turbo Pro
 *   pour la vidéo. Veo 3.1, par exemple, n'offre pas le 1:1.
 */

export const AWARENESS_LEVELS = [
  'unaware',
  'problem_aware',
  'solution_aware',
  'product_aware',
  'most_aware',
] as const;

export type AwarenessLevel = (typeof AWARENESS_LEVELS)[number];

/**
 * Direction créative par niveau de conscience (Eugene Schwartz, « Breakthrough
 * Advertising »). Rédigée en anglais : c'est la langue dans laquelle les modèles
 * d'image et de vidéo suivent le plus fidèlement une consigne.
 */
const AWARENESS_DIRECTION: Record<AwarenessLevel, string> = {
  unaware:
    'Stop-the-scroll everyday-life scene that sparks curiosity and emotion, without showing or naming the product.',
  problem_aware:
    'Show the problem or frustration the audience lives with, in a recognisable and relatable way, without exaggeration.',
  solution_aware:
    'Show the desired outcome this kind of solution brings, focused on the benefit, without any before/after comparison.',
  product_aware: 'Feature the product itself and what makes it different, clearly identifiable.',
  most_aware: 'Feature the offer: the product with a clear, honest call to action and no fake urgency.',
};

export const CREATIVE_FORMATS = ['1:1', '9:16', '16:9'] as const;


/**
 * Où vit le fichier d'un créatif — ce que le suivi a besoin de savoir, et rien d'autre.
 *
 * C'est bien l'ENDROIT qui est nommé, pas le modèle qui a dessiné. « interne » couvre tout
 * ce que nous produisons et gardons nous-mêmes ; derrière, la façade d'images choisit
 * Cloudflare, et bascule sur Gemini quand la réserve du jour est vide. Nommer la ligne
 * d'après le modèle la rendrait fausse une fois sur dix, et c'est une valeur qui reste en
 * base pour toujours.
 *
 * La vidéo est rendue par Veo ; « fal » ne reste que pour les vidéos d'avant la bascule.
 * Higgsfield, abandonné, n'est plus un fournisseur : ses anciennes lignes restent en base comme
 * historique, sans fichier (il effaçait tout au bout de sept jours).
 */
export type CreativeProvider = 'fal' | 'veo' | 'interne';

/**
 * Un moteur d'images est-il utilisable ? Gemini, ou Cloudflare s'il est configuré.
 *
 * Le rendu interne n'était choisi que si Cloudflare était configuré : un serveur doté de la
 * seule clé Gemini renvoyait chaque visuel vers Higgsfield, abandonné — et l'écran répondait
 * « service non configuré » alors qu'un moteur d'images était bel et bien disponible.
 */
export function imagesConfigured(): boolean {
  return cloudflareImagesConfigured() || geminiImagesConfigured();
}

export const VIDEO_PROVIDER: CreativeProvider = 'veo';

/**
 * Jours pendant lesquels le fichier reste récupérable, par fournisseur ; null : sans limite.
 *
 * Une seule durée (sept jours, celle de Higgsfield) valait pour tous, et elle était fausse
 * deux fois : Google n'y garde une vidéo Veo que DEUX jours (« Generated videos are stored on
 * the server for 2 days, after which they are removed », ai.google.dev/gemini-api/docs/veo,
 * vérifié le 28 septembre 2026) — l'utilisateur qui revenait le troisième jour trouvait un
 * fichier perdu qu'on lui avait promis pour une semaine ; et les visuels générés en interne,
 * enregistrés en base, n'expirent jamais.
 * fal.ai garde la durée précédemment appliquée, faute de durée publiée vérifiée.
 */
export const PROVIDER_RETENTION_DAYS: Record<CreativeProvider, number | null> = {
  veo: 2,
  fal: 7,
  interne: null,
};

/** Longueur maximale du prompt acceptée par Kling. */
const VIDEO_PROMPT_MAX = 2500;

const baseBrief = {
  productName: z.string().trim().min(1).max(120),
  awarenessLevel: z.enum(AWARENESS_LEVELS),
  format: z.enum(CREATIVE_FORMATS),
  market: marketSchema,
  audience: z.string().trim().max(300).optional(),
  sceneDescription: z.string().trim().min(3).max(600),
  onScreenText: z.string().trim().max(120).optional(),
  visualStyle: z.string().trim().max(300).optional(),
  /** Publicité (structurée par une méthode de rédaction) ou contenu non publicitaire. */
  purpose: z.enum(['ad', 'content']).default('ad'),
  adFramework: z.enum(AD_FRAMEWORK_IDS).optional(),
  /** Message de chaque étape de la méthode, dans l'ordre ; vide : consigne par défaut de l'étape. */
  frameworkBeats: z.array(z.string().trim().max(200)).max(6).optional(),
};

export const visualBriefSchema = z.object(baseBrief);

/*
  La vidéo n'accepte ni les mêmes formats ni les mêmes durées que l'image, et le schéma doit
  le dire plutôt que de le laisser découvrir en production.

  Veo ne rend que le 9:16 et le 16:9 — le carré est refusé par l'API, et aucun modèle vidéo
  du catalogue Google ne le rend. Ses durées forment un JEU DISCRET de 4, 6 et 8 secondes :
  5 et 7 sont refusés, alors même que le message d'erreur annonce « une valeur entre 4 et 8 ».

  Les visuels, eux, gardent le carré : leur modèle sait le faire.
*/
export const videoBriefSchema = z.object({
  ...baseBrief,
  format: z.enum(VEO_FORMATS),
  sceneDescription: z.string().trim().min(3).max(1500),
  duration: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  /**
   * Premier plan d'une vidéo longue, à prolonger ensuite par étapes de 7 s. Google ne prolonge
   * qu'une vidéo en 720p : ce plan y est donc rendu, en 8 secondes.
   */
  extendable: z.boolean().optional(),
});

export type VisualBrief = z.infer<typeof visualBriefSchema>;
export type VideoBrief = z.infer<typeof videoBriefSchema>;

/** Texte soumis au vérificateur de conformité avant toute génération. */
export function creativeText(brief: VisualBrief | VideoBrief): string {
  return [
    brief.productName,
    brief.audience,
    brief.sceneDescription,
    brief.onScreenText,
    brief.visualStyle,
    ...(brief.frameworkBeats ?? []),
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n');
}

/** Longueur maximale retenue pour la consigne du modèle d'image. */
const VISUAL_PROMPT_MAX = 3000;

/**
 * Structure de la méthode publicitaire choisie ; consigne « contenu » sinon.
 *
 * UNE IMAGE PUBLICITAIRE EST UNE SEULE SCÈNE. La consigne listait les étapes de la méthode
 * « dans l'ordre de lecture », avec leur nom : le moteur en tirait une planche en quatre cases,
 * chacune légendée « ATTENTION », « INTEREST », « DESIRE », « ACTION », en anglais et avec des
 * textes inventés (« Modest d'apartment in Yaoundé ») — vu sur un vrai visuel le 04/10/2026.
 * Une image qu'aucun vendeur ne peut diffuser. La méthode guide désormais la composition d'une
 * scène unique, et le nom de ses étapes ne part plus dans la consigne d'une image.
 *
 * Pour une vidéo, les étapes restent une suite de temps — mais sans leur nom, qui finissait
 * incrusté à l'écran.
 */
function frameworkLines(brief: VisualBrief | VideoBrief, durationSeconds?: number): string[] {
  if (brief.purpose === 'content') {
    return ['Purpose: organic content (presentation, tutorial or storytelling), not a hard-sell advertisement. No call to action.'];
  }
  const framework = findAdFramework(brief.adFramework);
  if (!framework) return [];

  const beats = framework.steps.map((step, index) => brief.frameworkBeats?.[index]?.trim() || step.direction);
  if (durationSeconds) {
    const count = beats.length;
    const seconds = (value: number) => value.toFixed(1).replace(/\.0$/, '');
    return [
      `Advertising storytelling structure: ${framework.acronym}. It guides the sequence only: never show or say the names of its steps.`,
      'Sequence the video in these beats, in this order:',
      ...beats.map(
        (beat, index) => `${index + 1}. (${seconds((index * durationSeconds) / count)}–${seconds(((index + 1) * durationSeconds) / count)} s) ${beat}`,
      ),
    ];
  }
  const role = (index: number) => (index === 0 ? 'What catches the eye first' : index === beats.length - 1 ? 'What the viewer is left wanting to do' : 'What the scene also makes visible');
  return [
    `The ${framework.acronym} advertising method guides how this single scene is composed. It is a guide for you, never something to draw: do not write or depict the names of its steps.`,
    'Within that one scene:',
    ...beats.map((beat, index) => `- ${role(index)}: ${beat}`),
  ];
}

/**
 * Consigne complète envoyée au modèle. Si elle dépasse sa limite, c'est la
 * description de scène qui est raccourcie : les garde-fous (marques, texte,
 * stéréotypes) partent toujours.
 */
function buildPrompt(brief: VisualBrief | VideoBrief, options: { maxLength: number; durationSeconds?: number }): string {
  const still = !options.durationSeconds;
  const kind = brief.purpose === 'content' ? (still ? 'Content image' : 'Video content') : still ? 'Advertising image' : 'Advertising video';
  const head = [
    `${kind} for "${brief.productName}".`,
    // Une image est UNE scène : sans cette ligne, le moteur rend volontiers une planche en plusieurs cases.
    ...(still
      ? ['ONE single image: one scene, one moment, one frame. Never a collage, a grid, a split screen, a storyboard, comic panels or a before/after pair.']
      : []),
    `Creative direction (prospect awareness level: ${brief.awarenessLevel.replace('_', ' ')}): ${AWARENESS_DIRECTION[brief.awarenessLevel]}`,
  ];
  const tail = [
    ...frameworkLines(brief, options.durationSeconds),
    `Setting and people grounded in ${countryName(brief.market, 'en')}, portrayed accurately and respectfully, without caricature or stereotypes.`,
    ...(brief.audience ? [`Target audience: ${brief.audience}.`] : []),
    ...(brief.visualStyle ? [`Visual style: ${brief.visualStyle}.`] : []),
    brief.onScreenText
      ? `The ONLY text allowed anywhere in the image is this one line, written once, exactly as given, same language and spelling: "${brief.onScreenText}". No other words at all: no captions, labels, headings, speech bubbles or interface text; any book cover, sign, screen or packaging in the scene stays blank or out of focus.`
      : 'No text anywhere: no captions, labels, headings, speech bubbles, logos or watermarks; any book cover, sign, screen or packaging in the scene stays blank or out of focus.',
    'No real brand logos, no celebrities, no invented testimonials, prices or figures.',
    ...(options.durationSeconds
      ? [`Duration: ${options.durationSeconds} seconds, smooth camera movement, the beats flowing naturally within one continuous take.`]
      : []),
  ];

  const fixed = [...head, ...tail].join('\n').length + '\nScene: '.length;
  const budget = Math.max(120, options.maxLength - fixed);
  const scene =
    brief.sceneDescription.length > budget ? `${brief.sceneDescription.slice(0, budget - 1)}…` : brief.sceneDescription;
  return [...head, `Scene: ${scene}`, ...tail].join('\n').slice(0, options.maxLength);
}

/** Consigne et format envoyés au moteur d'images. Fonction pure, testable sans appel réseau. */
export function buildVisualInput(brief: VisualBrief) {
  return {
    prompt: buildPrompt(brief, { maxLength: VISUAL_PROMPT_MAX }),
    aspect_ratio: brief.format,
  };
}

/**
 * Corps envoyé au modèle vidéo. Fonction pure, testable sans appel réseau.
 *
 * `duration` part en CHAÎNE : le schéma de Kling chez fal.ai n'accepte que « 5 » ou « 10 »
 * sous forme de texte, et refuse le nombre par un 422 qui ne dit pas pourquoi.
 */
export function buildVideoInput(brief: VideoBrief) {
  return {
    prompt: buildPrompt(brief, { maxLength: VIDEO_PROMPT_MAX, durationSeconds: brief.duration }),
    /*
      Veo accepte une consigne négative, là où le modèle d'image de Google n'en propose
      aucune. C'est par elle que passe l'interdiction des marques et du texte à l'écran —
      et ce n'est pas décoratif : les modèles récents dessinent spontanément des logos
      existants dès que rien ne le leur interdit, ce qui ferait diffuser à un client une
      publicité portant la marque d'autrui.
    */
    negativePrompt: 'distorted hands, unreadable text, brand logos, watermark',
    aspectRatio: brief.format,
    durationSeconds: brief.duration,
  };
}

/** États d'une génération, communs à tous les fournisseurs. « nsfw » : refusée par le filtre de sécurité. */
export type CreativeState = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled';

export interface CreativeStatus {
  requestId: string;
  status: CreativeState;
  /** Présent quand un fichier est prêt. Le lien lui-même reste côté serveur. */
  mediaType?: 'image' | 'video';
  message?: string;
  /** Jours pendant lesquels le fichier reste récupérable ; null : sans limite. Ajouté par la route. */
  retentionDays?: number | null;
}

/**
 * État de facturation d'une génération. « nsfw » et « canceled » ne produisent
 * aucun fichier : comme un échec, ils rendent les points.
 */
export function generationStateOf(status: CreativeStatus['status']): 'pending' | 'completed' | 'failed' {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'nsfw' || status === 'canceled') return 'failed';
  return 'pending';
}

/** Format du fichier produit, pour les statistiques de contenus. */
export function fileFormatOf(status: CreativeStatus): string | null {
  if (status.mediaType === 'video') return 'mp4';
  if (status.mediaType === 'image') return 'png';
  return null;
}

/** La file de fal.ai ne connaît que trois états ; ni « nsfw » ni « canceled » n'en font partie. */
const FAL_STATUS: Record<FalQueueStatus, CreativeStatus['status']> = {
  IN_QUEUE: 'queued',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
};

function falToClientStatus(generation: { requestId: string; status: FalQueueStatus; mediaType?: 'video' | 'image' }): CreativeStatus {
  return {
    requestId: generation.requestId,
    status: FAL_STATUS[generation.status],
    ...(generation.mediaType ? { mediaType: generation.mediaType } : {}),
  };
}

/** Veo ne connaît que trois états ; la file de rendu n'expose pas d'étape intermédiaire. */
function veoToClientStatus(generation: VeoGeneration): CreativeStatus {
  if (generation.status === 'failed') {
    return { requestId: generation.requestId, status: 'failed', ...(generation.error ? { message: generation.error } : {}) };
  }
  return {
    requestId: generation.requestId,
    status: generation.status === 'completed' ? 'completed' : 'queued',
    ...(generation.status === 'completed' ? { mediaType: 'video' as const } : {}),
  };
}

export async function submitVideo(brief: VideoBrief): Promise<CreativeStatus> {
  const input = buildVideoInput(brief);
  return veoToClientStatus(
    await submitVeoGeneration({
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      aspectRatio: input.aspectRatio,
      // Une vidéo longue part d'un plan de 8 s : c'est la base que Google prolonge.
      durationSeconds: brief.extendable ? 8 : input.durationSeconds,
      extendable: brief.extendable,
    }),
  );
}

/** Scène suivante d'une vidéo longue, décrite par l'auteur. */
export const extensionSchema = z.object({ sceneDescription: z.string().trim().min(3).max(800) });

/**
 * Consigne d'une prolongation. Les deux garde-fous des créatifs y sont repris mot pour mot :
 * une prolongation n'accepte pas de consigne négative documentée, et sans eux le modèle
 * ajoute de lui-même texte et logos (constaté sur les images, voir services/ai/image.ts).
 */
export function buildExtensionPrompt(scene: string): string {
  return [
    `Continue the previous shot seamlessly: ${scene}`,
    'Keep the same characters, setting, lighting and camera style as the end of the previous shot.',
    'No text, no logos, no watermarks. No real brand logos.',
  ].join(' ');
}

/**
 * Lance la prolongation d'une vidéo Veo : ses octets partent chez Google avec la scène suivante.
 * La copie archivée est lue d'abord (elle ne dépend pas de la conservation de Google), puis
 * l'original chez Google à défaut.
 */
export async function extendVideo(parentRequestId: string, scene: string): Promise<CreativeStatus> {
  let source = await fetchArchivedVideo(parentRequestId);
  if (!source) {
    const parent = await getVeoGeneration(parentRequestId);
    if (parent.status !== 'completed' || !parent.mediaUrl) {
      throw new AppError(409, 'La vidéo à prolonger n’est plus disponible.', 'VIDEO_NOT_EXTENDABLE');
    }
    source = await fetchVeoMedia(parent.mediaUrl);
  }
  const video = Buffer.from(await source.arrayBuffer());
  return veoToClientStatus(await submitVeoExtension({ prompt: buildExtensionPrompt(scene), video }));
}

/**
 * État d'une génération chez son fournisseur. Le fournisseur est lu sur la génération
 * enregistrée : chez fal.ai, l'identifiant du modèle fait partie de l'adresse de suivi,
 * donc un identifiant de demande seul ne suffit pas à retrouver le rendu.
 */
export async function getCreativeStatus(requestId: string, provider: CreativeProvider): Promise<CreativeStatus> {
  if (provider === 'veo') return veoToClientStatus(await getVeoGeneration(requestId));
  // Les vidéos lancées avant la bascule restent suivies chez fal.ai jusqu'à leur terme :
  // rien de ce qui a été payé ne devient inaccessible.
  if (provider === 'fal') return falToClientStatus(await getFalGeneration(env.FAL_VIDEO_MODEL, requestId));
  throw new AppError(404, 'Génération introuvable chez le fournisseur.', 'GENERATION_NOT_FOUND');
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/**
 * Type servi pour un fichier relayé. Seuls les types image et vidéo attendus passent : une
 * page HTML ou un SVG renvoyé par le fournisseur s'exécuterait sinon sur l'origine du site,
 * avec la session du visiteur.
 */
export function servedMediaType(announced: string | null, mediaType: 'image' | 'video'): string {
  const type = announced?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (Object.hasOwn(EXTENSIONS, type)) return type;
  return mediaType === 'video' ? 'video/mp4' : 'image/png';
}

/** Adresse de boucle locale : la seule tolérée hors HTTPS, et seulement hors production. */
const LOOPBACK = /^(127\.0\.0\.1|\[::1\]|localhost)$/;

/**
 * Récupère le fichier produit, quel que soit le fournisseur.
 *
 * Le chiffrement est exigé : un lien en clair exposerait le fichier du client sur le trajet.
 * La seule exception vise la boucle locale hors production, pour qu'une suite de tests puisse
 * servir un fichier depuis un serveur factice sans certificat — jamais en production, où la
 * condition `isProd` referme la porte.
 */
async function fetchGeneratedMedia(url: string): Promise<Response> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new AppError(502, 'Lien de fichier invalide renvoyé par le fournisseur.', 'CREATIVE_FILE_INVALID');
  }
  const enClairTolere = !isProd && target.protocol === 'http:' && LOOPBACK.test(target.hostname);
  if (target.protocol !== 'https:' && !enClairTolere) {
    throw new AppError(502, 'Lien de fichier non sécurisé renvoyé par le fournisseur.', 'CREATIVE_FILE_INSECURE');
  }
  let response: Response;
  try {
    response = await fetch(target, { signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new AppError(502, 'Le fichier généré est injoignable.', 'CREATIVE_FILE_UNREACHABLE');
  }
  if (!response.ok || !response.body) throw new AppError(502, 'Le fichier généré est injoignable.', 'CREATIVE_FILE_UNREACHABLE');
  return response;
}

/**
 * Relaie le fichier généré au navigateur.
 *
 * Servi depuis notre propre origine : la politique de sécurité du navigateur n'a
 * pas à s'ouvrir à un CDN tiers dont on ne connaît pas le domaine, et le
 * téléchargement porte un nom de fichier propre.
 */
export async function streamCreativeFile(
  requestId: string,
  provider: CreativeProvider,
  disposition: 'inline' | 'attachment',
  res: ExpressResponse,
): Promise<void> {
  /*
    Veo est à part sur un point : son lien de téléchargement N'EST PAS public, il exige la
    clé du serveur. Le relais générique, qui va chercher l'adresse sans en-tête, ramènerait
    un 403. C'est donc `fetchVeoMedia` qui télécharge, avec la clé — et le client ne voit ni
    le lien, ni la clé, comme pour tous les autres fournisseurs.
  */
  if (provider === 'veo') {
    // La copie archivée d'abord : elle survit aux deux jours de conservation de Google.
    const archived = await fetchArchivedVideo(requestId);
    if (archived) {
      await relayMedia(archived, 'video', requestId, disposition, res);
      return;
    }
    /*
      Un second essai avant de renoncer. Le lecteur vidéo ne demande le fichier qu'UNE fois :
      une coupure d'une seconde chez le fournisseur lui rendait une erreur, et l'auteur voyait
      une vidéo « cassée » alors qu'elle était prête (constaté le 04/10/2026 : 504 au premier
      appel, fichier servi huit secondes plus tard au second).
    */
    const upstream = await withOneRetry(async () => {
      const generation = await getVeoGeneration(requestId);
      if (generation.status !== 'completed' || !generation.mediaUrl) {
        throw new AppError(409, "Aucun fichier disponible : la génération n'est pas terminée.", 'CREATIVE_NOT_READY');
      }
      return fetchVeoMedia(generation.mediaUrl);
    });
    await relayMedia(upstream, 'video', requestId, disposition, res);
    return;
  }

  // Vidéos d'avant Veo, rendues chez fal.ai : suivies jusqu'à ce que fal efface le fichier.
  if (provider !== 'fal') throw new AppError(404, 'Contenu introuvable.', 'CREATIVE_NOT_FOUND');
  const generation = await getFalGeneration(env.FAL_VIDEO_MODEL, requestId);
  const media = generation.mediaUrl && generation.mediaType ? { mediaType: generation.mediaType, url: generation.mediaUrl } : null;
  if (!media) {
    throw new AppError(409, "Aucun fichier disponible : la génération n'est pas terminée.", 'CREATIVE_NOT_READY');
  }

  await relayMedia(await fetchGeneratedMedia(media.url), media.mediaType, requestId, disposition, res);
}

/** Réessaie une fois, après une courte pause, quand le fournisseur est injoignable ou trop lent. Jamais sur un refus. */
async function withOneRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof AppError) || ![502, 503, 504].includes(error.status)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    return run();
  }
}

/**
 * Écrit la réponse du fournisseur dans celle du navigateur, en-têtes de sécurité compris.
 *
 * Extrait parce que chaque fournisseur va chercher ses octets différemment — Veo exige la
 * clé du serveur, les autres non — mais que la façon de les SERVIR ne doit pas varier : le
 * type est toujours contraint, le contenu jamais deviné, et l'exécution toujours interdite.
 */
async function relayMedia(
  upstream: Response,
  mediaType: 'image' | 'video',
  requestId: string,
  disposition: 'inline' | 'attachment',
  res: ExpressResponse,
): Promise<void> {
  const contentType = servedMediaType(upstream.headers.get('content-type'), mediaType);
  const extension = EXTENSIONS[contentType]!;

  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  const length = upstream.headers.get('content-length');
  if (length) res.setHeader('Content-Length', length);
  res.setHeader('Content-Disposition', `${disposition}; filename="creatif-${requestId.slice(0, 8)}.${extension}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');

  try {
    await pipeline(Readable.fromWeb(upstream.body as unknown as NodeReadableStream), res);
  } catch {
    // Les en-têtes sont déjà partis : impossible de renvoyer une erreur JSON.
    // On coupe la connexion plutôt que de livrer un fichier tronqué comme complet.
    res.destroy();
  }
}
