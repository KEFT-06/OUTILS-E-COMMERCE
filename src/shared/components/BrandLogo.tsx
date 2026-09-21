import { cn } from '@/shared/lib/utils';

/**
 * Identité Smart Creator : le croissant et le mot-symbole « SMART CREATOR »
 * dans les deux couleurs du logo (vert #00C853, orange #F59E0B).
 *
 * Le logo est dessiné en SVG plutôt que chargé depuis une image : l'ancien
 * fichier JPEG était vide et l'écran affichait en permanence son repli.
 *
 * Contraste : les couleurs du mot-symbole sont celles de la marque. Les
 * logotypes sont exemptés du critère de contraste WCAG 1.4.3 ; l'attribut
 * `data-brand-wordmark` permet de les écarter explicitement des audits.
 */

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={cn('shrink-0', className)}>
      <circle cx="50" cy="50" r="49" fill="#ffffff" stroke="#e0e5df" strokeWidth="2" />
      <path d="M 50 10 A 40 40 0 1 0 78 78 A 34 34 0 1 1 50 16 Z" fill="#00c853" />
      <path d="M 44 20 A 30 30 0 0 0 44 80 A 25 25 0 0 1 44 25 Z" fill="#0f172a" />
      <path d="M 32 60 C 40 75 60 75 75 68 C 60 70 45 68 32 60 Z" fill="#00c853" />
    </svg>
  );
}

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  /** Masque le mot-symbole et ne garde que le croissant. */
  showText?: boolean;
  /** Affiche « Veille stratégique, production et création d’e-commerce » sous le nom. */
  showTagline?: boolean;
  className?: string;
}

const SIZES = {
  sm: { mark: 'size-7', word: 'text-sm', gap: 'gap-2' },
  md: { mark: 'size-9', word: 'text-base', gap: 'gap-2.5' },
  lg: { mark: 'size-12', word: 'text-xl', gap: 'gap-3' },
} as const;

export function BrandLogo({ size = 'md', showText = true, showTagline = false, className }: BrandLogoProps) {
  const s = SIZES[size];

  return (
    <span className={cn('inline-flex items-center', s.gap, className)}>
      <BrandMark className={s.mark} />
      {showText ? (
        <span className="flex min-w-0 flex-col leading-none">
          <span
            data-brand-wordmark=""
            className={cn('font-display font-black tracking-wide whitespace-nowrap', s.word)}
          >
            <span className="text-brand-green">SMART</span>{' '}
            <span className="text-brand-orange">CREATOR</span>
          </span>
          {showTagline ? (
            <span className="mt-1 truncate text-xs font-medium text-muted-foreground">
              Veille stratégique, production et création d’e-commerce
            </span>
          ) : null}
        </span>
      ) : (
        <span className="sr-only">Smart Creator</span>
      )}
    </span>
  );
}
