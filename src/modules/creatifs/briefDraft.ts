import type { AwarenessLevel, CreativeFormat, CreativeKind } from '@/shared/types/creatives';

/**
 * Brouillon du brief des créatifs, et les règles de format qu'il doit respecter.
 *
 * Séparé du composant pour être testé sans navigateur : c'est ici que se joue la protection
 * contre un brouillon ancien ou altéré, et cette protection doit tenir même quand personne ne
 * la regarde.
 */

/**
 * La vidéo n'offre pas les mêmes choix que l'image. Le modèle vidéo refuse le carré — mesuré
 * sur l'API, et aucun modèle vidéo du catalogue ne le rend. Ses durées forment un JEU DISCRET
 * de 4, 6 ou 8 secondes : cinq et dix, proposés jusqu'à la bascule, sont tous deux refusés.
 */
export const VISUAL_FORMATS: CreativeFormat[] = ['1:1', '9:16', '16:9'];
export const VIDEO_FORMATS: CreativeFormat[] = ['9:16', '16:9'];
export const VIDEO_DURATIONS = [4, 6, 8] as const;
export type VideoDuration = (typeof VIDEO_DURATIONS)[number];

/** Versionné : un changement de forme du brouillon change la clé plutôt que d'en relire un faux. */
export const CLE_BROUILLON = 'sc.creatifs.brouillon.v1';

export interface Brouillon {
  kind: CreativeKind;
  productName: string;
  awarenessLevel: AwarenessLevel | null;
  format: CreativeFormat;
  market: string;
  purpose: 'ad' | 'content';
  adFramework: string | null;
  frameworkBeats: string[];
  audience: string;
  sceneDescription: string;
  onScreenText: string;
  visualStyle: string;
  duration: VideoDuration;
}

const texte = (valeur: unknown, max: number) => (typeof valeur === 'string' ? valeur.slice(0, max) : '');

/**
 * Remet un brouillon en état de servir, SANS lui faire confiance.
 *
 * Il vient d'un stockage que l'auteur, une extension ou une version précédente du site ont pu
 * écrire. Le cas n'est pas théorique : un brouillon enregistré avant la bascule vers Veo porte
 * une durée de cinq secondes, voire le format carré en vidéo — que le modèle refuse tous deux.
 * Le restaurer tel quel ferait échouer le premier envoi sur un formulaire que l'auteur croit
 * valide, puisque c'est le sien. Les longueurs sont aussi rebornées aux limites du serveur.
 */
export function assainirBrouillon(brut: unknown): Partial<Brouillon> {
  if (!brut || typeof brut !== 'object') return {};
  const b = brut as Record<string, unknown>;

  const kind: CreativeKind = b.kind === 'video' ? 'video' : 'visual';
  const formats = kind === 'video' ? VIDEO_FORMATS : VISUAL_FORMATS;
  const format = formats.includes(b.format as CreativeFormat) ? (b.format as CreativeFormat) : '9:16';
  const duration = (VIDEO_DURATIONS as readonly number[]).includes(b.duration as number) ? (b.duration as VideoDuration) : 6;

  return {
    kind,
    productName: texte(b.productName, 120),
    awarenessLevel: typeof b.awarenessLevel === 'string' ? (b.awarenessLevel as AwarenessLevel) : null,
    format,
    ...(typeof b.market === 'string' && /^[A-Z]{2}$/.test(b.market) ? { market: b.market } : {}),
    purpose: b.purpose === 'content' ? 'content' : 'ad',
    adFramework: typeof b.adFramework === 'string' ? b.adFramework : null,
    frameworkBeats: Array.isArray(b.frameworkBeats) ? b.frameworkBeats.slice(0, 6).map((beat) => texte(beat, 200)) : [],
    audience: texte(b.audience, 300),
    sceneDescription: texte(b.sceneDescription, 1500),
    onScreenText: texte(b.onScreenText, 120),
    visualStyle: texte(b.visualStyle, 300),
    duration,
  };
}

/** Lit le brouillon du navigateur. Stockage bloqué ou contenu illisible : formulaire vide. */
export function lireBrouillon(): Partial<Brouillon> {
  try {
    return assainirBrouillon(JSON.parse(window.localStorage.getItem(CLE_BROUILLON) ?? 'null'));
  } catch {
    return {};
  }
}
