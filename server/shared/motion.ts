/**
 * Vidéo animée : un scénario, mis en images par une composition HyperFrames.
 *
 * Demande du client, le 08/10/2026 : produire les vidéos avec Claude et HyperFrames, à la place
 * du rendu génératif. HyperFrames (HeyGen, licence Apache 2.0) décrit une vidéo comme une page
 * HTML : chaque élément porte son instant d'entrée et sa durée, et une animation GSAP, mise en
 * pause, est rejouée image par image par le moteur de rendu. Même entrée, même vidéo.
 *
 * LE RÉDACTEUR N'ÉCRIT AUCUN CODE. Il rend un scénario — des scènes, leurs textes, leur durée,
 * leur mouvement —, et c'est ce fichier qui en fait la page. Deux raisons :
 *   · une page écrite par un modèle s'exécute dans le navigateur de l'auteur, sous son compte ;
 *     le texte d'une publicité concurrente, repris dans un brief, pourrait y glisser un script ;
 *   · un scénario se corrige scène par scène dans un formulaire, et la vidéo se rejoue aussitôt.
 * Le seul script de la page est le nôtre (motionRuntime.ts), et tout texte y entre échappé.
 *
 * Fichier pur : aucun accès au réseau ni à la base, donc partagé avec l'écran et testable seul.
 */

export const MOTION_FORMATS = ['9:16', '16:9', '1:1'] as const;
export type MotionFormat = (typeof MOTION_FORMATS)[number];

/** Taille de l'image rendue, en pixels (celles que le rendu HyperFrames accepte en 1080p). */
export const MOTION_SIZES: Record<MotionFormat, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
};

/** Mouvement lent du fond pendant la scène : c'est lui qui fait d'une image fixe un plan. */
export const MOTION_MOVES = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'rise'] as const;
export type MotionMove = (typeof MOTION_MOVES)[number];

/** Où se pose le texte : il laisse libre la partie de l'image qui porte le sujet. */
export const MOTION_LAYOUTS = ['bottom', 'center', 'top'] as const;
export type MotionLayout = (typeof MOTION_LAYOUTS)[number];

export const MOTION_THEMES = {
  nuit: { label: 'Nuit', from: '#0B1220', to: '#1E293B', accent: '#38BDF8', text: '#FFFFFF' },
  foret: { label: 'Forêt', from: '#052E1B', to: '#0F5132', accent: '#4ADE80', text: '#FFFFFF' },
  braise: { label: 'Braise', from: '#3B0A0A', to: '#9A3412', accent: '#FDBA74', text: '#FFFFFF' },
  royal: { label: 'Royal', from: '#1E1B4B', to: '#4C1D95', accent: '#FACC15', text: '#FFFFFF' },
  sable: { label: 'Sable', from: '#FDF6E3', to: '#F5D9A8', accent: '#B45309', text: '#1F2937' },
} as const;
export type MotionTheme = keyof typeof MOTION_THEMES;
export const MOTION_THEME_IDS = Object.keys(MOTION_THEMES) as MotionTheme[];

export const MOTION_LIMITS = {
  scenesMin: 2,
  scenesMax: 12,
  secondsMin: 2,
  secondsMax: 10,
  /** Durée totale : au-delà, ce n'est plus une publicité, et le rendu se facture à la minute. */
  totalMax: 90,
  kickerMax: 40,
  headlineMax: 70,
  bodyMax: 140,
  voiceoverMax: 320,
  visualMax: 500,
  callToActionMax: 40,
} as const;

export interface MotionScene {
  id: string;
  seconds: number;
  /** Quelques mots au-dessus du titre (« Le problème », « Jour 1 ») ; vide : rien. */
  kicker: string;
  headline: string;
  body: string;
  /** Ce que dit la voix pendant la scène. */
  voiceover: string;
  /** Ce que montre l'image de fond, décrit pour le moteur d'images (sans aucun texte). */
  visual: string;
  move: MotionMove;
  layout: MotionLayout;
}

export interface MotionScenario {
  title: string;
  theme: MotionTheme;
  scenes: MotionScene[];
  /** Texte du bouton de la dernière scène ; vide : pas de bouton (contenu, et non publicité). */
  callToAction: string;
}

/** Fondu d'une scène sur la précédente, en secondes. */
const FADE = 0.45;

/** Instant d'entrée de chaque scène, et durée totale. */
export function motionTimings(scenario: MotionScenario): { scenes: { id: string; start: number; seconds: number }[]; total: number } {
  let start = 0;
  const scenes = scenario.scenes.map((scene) => {
    const timing = { id: scene.id, start, seconds: scene.seconds };
    start = Math.round((start + scene.seconds) * 100) / 100;
    return timing;
  });
  return { scenes, total: start };
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Un titre court se lit de loin : sa taille suit sa longueur, il ne déborde jamais du cadre. */
function headlineSize(length: number, unit: number, wide: boolean): number {
  const base = length <= 26 ? 118 : length <= 46 ? 96 : 78;
  return Math.round(base * unit * (wide ? 1.1 : 1));
}

/**
 * Page HTML de la vidéo, au format HyperFrames. `images` : adresse de l'image de fond de chaque
 * scène, par identifiant ; une scène sans image reçoit le dégradé du thème.
 *
 * Les deux scripts viennent d'adresses que l'appelant choisit : celles du site pour la lecture à
 * l'écran (la politique de sécurité n'y admet que ses propres scripts), des fichiers du lot pour
 * le rendu.
 */
export function buildMotionComposition(
  scenario: MotionScenario,
  options: { format: MotionFormat; images?: Readonly<Record<string, string>>; gsapUrl: string; runtimeUrl: string },
): string {
  const { width, height } = MOTION_SIZES[options.format];
  const theme = MOTION_THEMES[scenario.theme];
  const unit = Math.min(width, height) / 1080;
  const wide = width > height;
  const margin = Math.round(84 * unit);
  const px = (value: number) => `${Math.round(value * unit)}px`;
  const { scenes: timings, total } = motionTimings(scenario);

  const scenes = scenario.scenes
    .map((scene, index) => {
      const timing = timings[index]!;
      const last = index === scenario.scenes.length - 1;
      // La scène reste à l'écran le temps que la suivante se fonde par-dessus : pas de trou noir entre deux plans.
      const duration = Math.round((scene.seconds + (last ? 0 : FADE)) * 100) / 100;
      const image = options.images?.[scene.id];
      const words = scene.headline
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => `<span class="mot">${escapeHtml(word)}</span>`)
        .join(' ');
      return [
        // Deux pistes en alternance : deux scènes qui se chevauchent le temps d'un fondu ne partagent jamais la même.
        `  <div id="${scene.id}" class="clip scene ${scene.layout}" style="z-index:${index + 1}" data-start="${timing.start}" data-duration="${duration}" data-track-index="${index % 2}">`,
        image ? `    <img class="fond" src="${escapeHtml(image)}" alt="">` : '    <div class="fond uni"></div>',
        `    <div class="voile${image ? '' : ' leger'}"></div>`,
        '    <div class="texte">',
        ...(scene.kicker ? [`      <p class="surtitre">${escapeHtml(scene.kicker)}</p>`] : []),
        `      <h1 class="titre" style="font-size:${headlineSize(scene.headline.length, unit, wide)}px">${words}</h1>`,
        ...(scene.body ? [`      <p class="corps">${escapeHtml(scene.body)}</p>`] : []),
        ...(last && scenario.callToAction ? [`      <p class="bouton">${escapeHtml(scenario.callToAction)}</p>`] : []),
        '    </div>',
        '  </div>',
      ].join('\n');
    })
    .join('\n');

  const plan = {
    id: 'video',
    total,
    fade: FADE,
    scenes: scenario.scenes.map((scene, index) => ({ id: scene.id, start: timings[index]!.start, seconds: scene.seconds, move: scene.move })),
  };
  // « < » échappé : un texte de scène ne peut pas refermer la balise et ouvrir la sienne.
  const planJson = JSON.stringify(plan).replace(/</g, '\\u003c');

  const css = [
    'html,body{margin:0;background:#000}',
    `#stage{position:relative;width:${width}px;height:${height}px;overflow:hidden;font-family:"Plus Jakarta Sans","Segoe UI",system-ui,-apple-system,sans-serif;color:${theme.text}}`,
    '.scene{position:absolute;inset:0;overflow:hidden}',
    '.fond{position:absolute;left:-8%;top:-8%;width:116%;height:116%;object-fit:cover}',
    `.fond.uni{background:linear-gradient(160deg,${theme.from},${theme.to})}`,
    `.voile{position:absolute;inset:0;background:linear-gradient(180deg,${theme.from}66 0%,${theme.from}22 38%,${theme.from}F2 100%)}`,
    '.voile.leger{background:none}',
    `.texte{position:absolute;left:${margin}px;right:${margin}px;display:flex;flex-direction:column;gap:${px(28)}}`,
    `.bottom .texte{bottom:${Math.round(margin * 1.6)}px}`,
    `.top .texte{top:${Math.round(margin * 1.4)}px}`,
    '.center .texte{top:50%;transform:translateY(-50%)}',
    `.center .voile{background:${theme.from}99}`,
    `.top .voile{background:linear-gradient(0deg,${theme.from}66 0%,${theme.from}22 38%,${theme.from}F2 100%)}`,
    `.surtitre{margin:0;font-size:${px(38)};font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${theme.accent}}`,
    '.titre{margin:0;font-weight:800;line-height:1.06;letter-spacing:-.02em}',
    '.mot{display:inline-block}',
    `.corps{margin:0;font-size:${px(46)};font-weight:500;line-height:1.3;opacity:.94}`,
    `.bouton{margin:${px(12)} 0 0;align-self:flex-start;padding:${px(26)} ${px(54)};border-radius:999px;background:${theme.accent};color:${theme.from};font-size:${px(44)};font-weight:800}`,
    `.progression{position:absolute;left:0;right:0;bottom:0;height:${px(10)};z-index:99}`,
    `#barre{display:block;height:100%;background:${theme.accent};transform-origin:left center}`,
  ].join('\n');

  return [
    '<!doctype html>',
    '<html lang="fr">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta name="viewport" content="width=${width}">`,
    `<title>${escapeHtml(scenario.title)}</title>`,
    `<style>\n${css}\n</style>`,
    '</head>',
    '<body>',
    `<div id="stage" data-composition-id="video" data-start="0" data-duration="${total}" data-width="${width}" data-height="${height}">`,
    scenes,
    `  <div class="clip progression" data-start="0" data-duration="${total}" data-track-index="2"><span id="barre"></span></div>`,
    '</div>',
    `<script type="application/json" id="plan">${planJson}</script>`,
    `<script src="${escapeHtml(options.gsapUrl)}"></script>`,
    `<script src="${escapeHtml(options.runtimeUrl)}"></script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
