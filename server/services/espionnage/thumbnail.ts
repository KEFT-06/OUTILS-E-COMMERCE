import jpeg from 'jpeg-js';

/**
 * Allège l'aperçu d'une publicité avant de le garder.
 *
 * Mesuré le 18/10/2026 sur quinze aperçus réels de la bibliothèque : 100 Ko en moyenne, et
 * jusqu'à 223 Ko pour l'image d'une vidéo en 1080 × 1920. La carte du mur fait 300 à 400 points
 * de large, soit 800 au plus sur un écran à haute densité. Ramenés à 640 points sur leur plus
 * grand côté, en JPEG de qualité 76, les mêmes aperçus pèsent 36 Ko en moyenne, et le texte d'une
 * capture d'écran reste lisible. Le stockage suit le mur : trois fois moins de place pour le même
 * nombre d'annonces.
 *
 * Seul un JPEG plus grand que la limite est réencodé : réencoder une petite image l'alourdit.
 * Une image illisible est gardée telle quelle — alléger n'est jamais une raison de perdre un aperçu.
 */

export const THUMBNAIL_MAX_SIDE = 640;
const QUALITY = 76;
/** Garde-fou de mémoire du décodeur : une image de 1080 × 1920 points en demande une dizaine. */
const MAX_MEMORY_MB = 128;

export interface Thumbnail {
  bytes: Buffer;
  type: string;
}

export function shrinkThumbnail(image: Thumbnail): Thumbnail {
  if (image.type !== 'image/jpeg') return image;
  let source: { width: number; height: number; data: Uint8Array };
  try {
    source = jpeg.decode(image.bytes, { useTArray: true, maxMemoryUsageInMB: MAX_MEMORY_MB });
  } catch {
    return image;
  }
  const scale = THUMBNAIL_MAX_SIDE / Math.max(source.width, source.height);
  if (!(scale < 1)) return image;

  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const data = new Uint8Array(width * height * 4);
  // Chaque point réduit est la moyenne des points qu'il recouvre : pas de crénelage sur le texte.
  for (let y = 0; y < height; y += 1) {
    const top = Math.floor(y / scale);
    const bottom = Math.min(source.height, Math.max(top + 1, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x += 1) {
      const left = Math.floor(x / scale);
      const right = Math.min(source.width, Math.max(left + 1, Math.floor((x + 1) / scale)));
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let sy = top; sy < bottom; sy += 1) {
        for (let sx = left; sx < right; sx += 1) {
          const at = (sy * source.width + sx) * 4;
          red += source.data[at]!;
          green += source.data[at + 1]!;
          blue += source.data[at + 2]!;
          count += 1;
        }
      }
      const out = (y * width + x) * 4;
      data[out] = red / count;
      data[out + 1] = green / count;
      data[out + 2] = blue / count;
      data[out + 3] = 255;
    }
  }
  const bytes = Buffer.from(jpeg.encode({ data, width, height }, QUALITY).data);
  return bytes.length < image.bytes.length ? { bytes, type: 'image/jpeg' } : image;
}
