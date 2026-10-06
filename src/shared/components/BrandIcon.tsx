import { useId } from 'react';
import { BRAND_GLYPHS, type GlyphBrand } from '@/shared/components/brandGlyphs';
import { cn } from '@/shared/lib/utils';

/**
 * Logo d'une plateforme, à SES couleurs.
 *
 * Une icône grise ne dit pas de quelle plateforme on parle : on reconnaît Facebook à son bleu,
 * Instagram à son dégradé, WhatsApp à son vert (demande du propriétaire, 06/10/2026). Partout où
 * le site nomme une plateforme, il la montre donc telle qu'on la connaît.
 *
 * Les logos noirs (Threads, TikTok, X) suivent la couleur du texte : noirs sur fond clair,
 * blancs sur fond sombre, comme le font ces marques elles-mêmes.
 */

/** Marques montrées par leur propre icône de site : elles n'ont pas de tracé publié. */
const PICTURES = {
  chariow: { name: 'Chariow', src: '/marques/chariow.ico' },
  maketou: { name: 'Maketou', src: '/marques/maketou.ico' },
} as const;

export type Brand = GlyphBrand | keyof typeof PICTURES | 'google';

export const brandName = (brand: Brand): string =>
  brand === 'google' ? 'Google' : brand in PICTURES ? PICTURES[brand as keyof typeof PICTURES].name : BRAND_GLYPHS[brand as GlyphBrand].name;

/** Dégradés officiels, du coin bas-gauche au coin haut-droit. */
const GRADIENTS: Partial<Record<GlyphBrand, readonly [number, string][]>> = {
  instagram: [
    [0, '#FFD600'],
    [0.25, '#FF7A00'],
    [0.5, '#FF0069'],
    [0.75, '#D300C5'],
    [1, '#7638FA'],
  ],
  messenger: [
    [0, '#0099FF'],
    [0.6, '#A033FF'],
    [0.9, '#FF5280'],
    [1, '#FF7061'],
  ],
};

export function BrandIcon({
  brand,
  className,
  decorative = false,
}: {
  brand: Brand;
  className?: string;
  /** Le nom de la plateforme est déjà écrit à côté : l'icône n'est pas relue par un lecteur d'écran. */
  decorative?: boolean;
}) {
  const gradientId = useId();
  const label = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': brandName(brand) };
  const size = cn('size-4 shrink-0', className);

  if (brand === 'chariow' || brand === 'maketou') {
    return <img src={PICTURES[brand].src} alt={decorative ? '' : PICTURES[brand].name} className={cn(size, 'rounded-[3px] object-contain')} />;
  }

  if (brand === 'google') {
    return (
      <svg viewBox="0 0 24 24" className={size} {...label}>
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
      </svg>
    );
  }

  const glyph = BRAND_GLYPHS[brand];

  // TikTok : la note noire et ses deux reflets, cyan et rouge — c'est à eux qu'on la reconnaît.
  if (brand === 'tiktok') {
    return (
      <svg viewBox="-1 -1 26 26" className={cn(size, 'text-foreground')} {...label}>
        <path d={glyph.path} fill="#25F4EE" transform="translate(-0.9 -0.9)" />
        <path d={glyph.path} fill="#FE2C55" transform="translate(0.9 0.9)" />
        <path d={glyph.path} fill="currentColor" />
      </svg>
    );
  }

  const stops = GRADIENTS[brand];
  return (
    <svg viewBox="0 0 24 24" className={cn(size, glyph.color === 'currentColor' && 'text-foreground')} {...label}>
      {stops && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            {stops.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
      )}
      <path d={glyph.path} fill={stops ? `url(#${gradientId})` : glyph.color} />
    </svg>
  );
}
