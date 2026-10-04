import { decode as decodePng } from 'fast-png';
import jpeg from 'jpeg-js';

/**
 * Allège une illustration avant de la garder.
 *
 * Le moteur rend des images de 0,7 à 1 Mo : un conte de vingt pages ferait un PDF de 20 Mo,
 * à télécharger sur un forfait mobile. Réencodée en JPEG à qualité 82, la même image pèse
 * trois fois moins (1 028 Ko → 386 Ko, mesuré le 04/10/2026) sans différence visible à
 * l'écran ni à l'impression d'un livre au format A5.
 *
 * Tout se fait en JavaScript pur : le serveur est assemblé en un seul fichier, et un module
 * natif n'y entrerait pas. Une image illisible ou d'un format inattendu est gardée telle
 * quelle — alléger n'est jamais une raison de perdre une page.
 */

const QUALITY = 82;
/** Garde-fou de mémoire du décodeur : une illustration de 1 200 × 900 points en demande une quinzaine. */
const MAX_MEMORY_MB = 256;

export interface StoryPicture {
  mimeType: string;
  bytes: Buffer;
}

interface Pixels {
  width: number;
  height: number;
  /** Rouge, vert, bleu, opacité : quatre octets par point. */
  data: Uint8Array;
}

/** PNG ramené à quatre octets par point, la transparence posée sur du blanc. Null : forme non gérée. */
function pngPixels(bytes: Buffer): Pixels | null {
  const png = decodePng(bytes);
  if (png.palette || (png.depth !== 8 && png.depth !== 16)) return null;
  const { width, height, channels } = png;
  const shift = png.depth === 16 ? 8 : 0;
  const data = new Uint8Array(width * height * 4);
  for (let point = 0, out = 0; point < width * height; point += 1, out += 4) {
    const at = point * channels;
    const value = (offset: number) => (png.data[at + offset] ?? 0) >> shift;
    const grey = channels < 3;
    const alpha = channels === 2 ? value(1) : channels === 4 ? value(3) : 255;
    const onWhite = (colour: number) => Math.round((colour * alpha + 255 * (255 - alpha)) / 255);
    data[out] = onWhite(value(0));
    data[out + 1] = onWhite(grey ? value(0) : value(1));
    data[out + 2] = onWhite(grey ? value(0) : value(2));
    data[out + 3] = 255;
  }
  return { width, height, data };
}

export function compactPicture(image: StoryPicture): StoryPicture {
  try {
    const pixels: Pixels | null =
      image.mimeType === 'image/jpeg'
        ? jpeg.decode(image.bytes, { useTArray: true, maxMemoryUsageInMB: MAX_MEMORY_MB })
        : image.mimeType === 'image/png'
          ? pngPixels(image.bytes)
          : null;
    if (!pixels) return image;
    const lighter = jpeg.encode(pixels, QUALITY).data;
    // Un PNG devient toujours un JPEG : le PDF l'intègre sans le décoder. Un JPEG n'est remplacé que s'il y gagne.
    if (image.mimeType === 'image/jpeg' && lighter.length >= image.bytes.length) return image;
    return { mimeType: 'image/jpeg', bytes: Buffer.from(lighter) };
  } catch (error) {
    console.warn('[conte] illustration gardée telle quelle :', error instanceof Error ? error.message : error);
    return image;
  }
}
