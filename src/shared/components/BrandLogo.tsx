import { cn } from '@/shared/lib/utils';

/**
 * Identité Smart Creator : l'emblème du logo fourni, et le mot-symbole « SMART CREATOR »
 * dans les deux couleurs de la marque (vert #00C853, orange #F59E0B).
 *
 * L'emblème vient désormais de l'image du graphiste, RECADRÉE sur la seule illustration.
 * Le nom qu'elle contient n'est pas repris : à 32 px il serait illisible, et il apparaîtrait
 * une seconde fois juste à côté en texte sélectionnable. Le mot-symbole reste donc du texte —
 * il s'adapte au thème sombre, se traduit et se lit par un lecteur d'écran, ce qu'une image ne
 * fait pas. L'image entière, nom compris, s'affiche par `BrandPoster`, là où elle a la place.
 *
 * Contraste : les couleurs du mot-symbole sont celles de la marque. Les
 * logotypes sont exemptés du critère de contraste WCAG 1.4.3 ; l'attribut
 * `data-brand-wordmark` permet de les écarter explicitement des audits.
 */

/** Image de marque complète : emblème ET mot-symbole, composés par le graphiste. */
export const BRAND_IMAGE = '/marque-smart-creator.jpg';

/*
  Recadrage de l'emblème, MESURÉ et non estimé.

  L'image fait 1222 × 864 et contient deux choses : l'illustration en haut, le nom écrit en bas.
  Une analyse du profil d'encre, ligne par ligne, dans un navigateur, les a séparées :

      y   96 → 610   l'illustration (robot, flèches, diamant)
      y  624 → 760   le nom et la signature, larges et réguliers

  Un carré de 520 px pris en (355, 90) tient donc entièrement dans l'illustration, sans mordre
  sur le texte. Utiliser l'image entière comme icône afficherait le nom deux fois — une fois
  illisible dans un carré de 32 px, une fois en toutes lettres à côté.

  Les trois nombres ci-dessous découlent de ce carré :
      largeur  = 1222 / 520           = 235 %
      décalage x = 355 / 520          = 68,3 % de la largeur du cadre
      décalage y =  90 / 520          = 17,3 %
*/
const EMBLEME = { width: '235%', left: '-68.3%', top: '-17.3%' } as const;

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('relative block shrink-0 overflow-hidden rounded-full bg-white', className)}>
      <img
        src={BRAND_IMAGE}
        alt=""
        aria-hidden="true"
        className="absolute max-w-none"
        style={EMBLEME}
        draggable={false}
      />
    </span>
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

  /*
    `min-w-0` et `max-w-full` ne sont pas décoratifs : sans eux, la signature impose sa largeur.

    `truncate` pose `white-space: nowrap`, et ne coupe le texte que si un parent contraint la
    largeur. Un `inline-flex` se dimensionne au contenu : la signature — cinquante-cinq
    caractères — figeait le bloc à 377 px. Le pied de page de l'accueil dépassait alors tout
    écran plus étroit, et la page entière défilait latéralement sur un mobile de 320 ou 360 px,
    soit la majorité du parc africain. Le défaut est corrigé ici plutôt qu'à chaque appel : un
    prochain usage de `showTagline` ne le réintroduira pas.
  */
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center', s.gap, className)}>
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

/**
 * L'image de marque entière — illustration et nom composés par le graphiste — pour les endroits
 * qui ont la place de la montrer : l'accueil et le panneau de connexion.
 *
 * Elle n'est pas décorative : elle porte le nom du produit, d'où un vrai texte alternatif.
 * `loading="lazy"` et une largeur bornée parce qu'elle pèse 108 Ko, ce qui compte sur une
 * connexion mobile africaine — la même raison qui interdit de la servir comme icône.
 */
export function BrandPoster({ className }: { className?: string }) {
  return (
    <img
      src={BRAND_IMAGE}
      alt="Smart Creator — veille stratégique et production, e-commerce de produits digitaux"
      width={1222}
      height={864}
      loading="lazy"
      decoding="async"
      className={cn('h-auto w-full max-w-lg rounded-xl', className)}
    />
  );
}
