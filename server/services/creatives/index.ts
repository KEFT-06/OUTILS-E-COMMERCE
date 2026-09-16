import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { AppError, marketSchema } from '@server/middleware';
import {
  HiggsfieldStatus,
  fetchMedia,
  getGenerationStatus,
  submitGeneration,
} from '@server/services/higgsfield';
import { AD_FRAMEWORK_IDS, findAdFramework } from '@server/shared/adFrameworks';
import { countryName } from '@server/shared/countries';

/**
 * Créatifs publicitaires : visuels et vidéos — feuille de route 4.1, 4.2 et 4.4.
 *
 * - Le niveau de conscience du prospect est obligatoire dans le schéma : il
 *   oriente toute la direction créative, et un créatif sans cible de conscience
 *   parle à tout le monde, donc à personne.
 * - Les trois formats du cahier des charges (1:1, 9:16, 16:9) sont ceux que les
 *   deux modèles retenus acceptent tous : Soul pour l'image, Kling v2.1 pour la
 *   vidéo. Veo 3.1, par exemple, n'offre pas le 1:1.
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

export const VISUAL_MODEL_PATH = '/higgsfield-ai/soul/standard';
export const VIDEO_MODEL_PATH = '/kling-video/v2.1/master/text-to-video';

/** Longueur maximale du prompt acceptée par Kling v2.1. */
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

export const videoBriefSchema = z.object({
  ...baseBrief,
  sceneDescription: z.string().trim().min(3).max(1500),
  duration: z.union([z.literal(5), z.literal(10)]),
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

/** Structure de la méthode publicitaire choisie, étape par étape ; consigne « contenu » sinon. */
function frameworkLines(brief: VisualBrief | VideoBrief, durationSeconds?: number): string[] {
  if (brief.purpose === 'content') {
    return ['Purpose: organic content (presentation, tutorial or storytelling), not a hard-sell advertisement. No call to action.'];
  }
  const framework = findAdFramework(brief.adFramework);
  if (!framework) return [];

  const count = framework.steps.length;
  const seconds = (value: number) => value.toFixed(1).replace(/\.0$/, '');
  return [
    `Advertising copywriting structure: ${framework.acronym} (${framework.steps.map((step) => step.name).join(', ')}).`,
    durationSeconds
      ? 'Sequence the video in these beats, in this order:'
      : 'Compose the single image so that it conveys these beats, in reading order:',
    ...framework.steps.map((step, index) => {
      const custom = brief.frameworkBeats?.[index]?.trim();
      const timing = durationSeconds
        ? ` (${seconds((index * durationSeconds) / count)}–${seconds(((index + 1) * durationSeconds) / count)} s)`
        : '';
      return `${index + 1}. ${step.name}${timing}: ${custom || step.direction}`;
    }),
  ];
}

/**
 * Consigne complète envoyée au modèle. Si elle dépasse sa limite, c'est la
 * description de scène qui est raccourcie : les garde-fous (marques, texte,
 * stéréotypes) partent toujours.
 */
function buildPrompt(brief: VisualBrief | VideoBrief, options: { maxLength: number; durationSeconds?: number }): string {
  const head = [
    `${brief.purpose === 'content' ? 'Video content' : 'Advertising creative'} for "${brief.productName}".`,
    `Creative direction (prospect awareness level: ${brief.awarenessLevel.replace('_', ' ')}): ${AWARENESS_DIRECTION[brief.awarenessLevel]}`,
  ];
  const tail = [
    ...frameworkLines(brief, options.durationSeconds),
    `Setting and people grounded in ${countryName(brief.market, 'en')}, portrayed accurately and respectfully, without caricature or stereotypes.`,
    ...(brief.audience ? [`Target audience: ${brief.audience}.`] : []),
    ...(brief.visualStyle ? [`Visual style: ${brief.visualStyle}.`] : []),
    brief.onScreenText
      ? `If text appears, it must read exactly: "${brief.onScreenText}". No other text.`
      : 'No text, no logos, no watermarks.',
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

/** Corps envoyé au modèle d'image. Fonction pure, testable sans appel réseau. */
export function buildVisualInput(brief: VisualBrief) {
  return {
    prompt: buildPrompt(brief, { maxLength: VISUAL_PROMPT_MAX }),
    num_images: 1,
    resolution: '2K',
    aspect_ratio: brief.format,
  };
}

/** Corps envoyé au modèle vidéo. Fonction pure, testable sans appel réseau. */
export function buildVideoInput(brief: VideoBrief) {
  return {
    prompt: buildPrompt(brief, { maxLength: VIDEO_PROMPT_MAX, durationSeconds: brief.duration }),
    duration: brief.duration,
    aspect_ratio: brief.format,
    cfg_scale: 0.5,
    negative_prompt: 'distorted hands, unreadable text, brand logos, watermark',
  };
}

export interface CreativeStatus {
  requestId: string;
  status: HiggsfieldStatus['status'];
  /** Présent quand un fichier est prêt. Le lien lui-même reste côté serveur. */
  mediaType?: 'image' | 'video';
  message?: string;
}

function resultMedia(status: HiggsfieldStatus): { mediaType: 'image' | 'video'; url: string } | null {
  if (status.status !== 'completed') return null;
  if (status.video?.url) return { mediaType: 'video', url: status.video.url };
  const imageUrl = status.images?.[0]?.url;
  return imageUrl ? { mediaType: 'image', url: imageUrl } : null;
}

const STATUS_MESSAGES: Partial<Record<HiggsfieldStatus['status'], string>> = {
  nsfw: 'Le contenu généré a été refusé par le filtre de sécurité du fournisseur. Cette génération ne vous est pas facturée.',
  canceled: 'La génération a été annulée.',
};

function toClientStatus(status: HiggsfieldStatus): CreativeStatus {
  const media = resultMedia(status);
  const message =
    status.status === 'failed'
      ? (status.error ?? 'La génération a échoué chez Higgsfield.')
      : STATUS_MESSAGES[status.status];

  return {
    requestId: status.request_id,
    status: status.status,
    ...(media ? { mediaType: media.mediaType } : {}),
    ...(message ? { message } : {}),
  };
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

export async function submitVisual(brief: VisualBrief): Promise<CreativeStatus> {
  return toClientStatus(await submitGeneration(VISUAL_MODEL_PATH, buildVisualInput(brief)));
}

export async function submitVideo(brief: VideoBrief): Promise<CreativeStatus> {
  return toClientStatus(await submitGeneration(VIDEO_MODEL_PATH, buildVideoInput(brief)));
}

export async function getCreativeStatus(requestId: string): Promise<CreativeStatus> {
  return toClientStatus(await getGenerationStatus(requestId));
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

/**
 * Relaie le fichier généré au navigateur.
 *
 * Servi depuis notre propre origine : la politique de sécurité du navigateur n'a
 * pas à s'ouvrir à un CDN tiers dont on ne connaît pas le domaine, et le
 * téléchargement porte un nom de fichier propre.
 */
export async function streamCreativeFile(
  requestId: string,
  disposition: 'inline' | 'attachment',
  res: ExpressResponse,
): Promise<void> {
  const media = resultMedia(await getGenerationStatus(requestId));
  if (!media) {
    throw new AppError(409, "Aucun fichier disponible : la génération n'est pas terminée.", 'CREATIVE_NOT_READY');
  }

  const upstream = await fetchMedia(media.url);
  const contentType = servedMediaType(upstream.headers.get('content-type'), media.mediaType);
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
