import { type BookCoverText, coverPalette, coverTitleScale } from '@/shared/lib/bookCover';
import { cn } from '@/shared/lib/utils';

/**
 * La couverture d'un ouvrage, à l'écran : le même dessin que le fichier à télécharger et que la
 * première page du PDF (shared/lib/bookCover).
 *
 * Tout ouvrage en a une, avec son titre dessus. Avec illustration, le titre est posé sur elle ;
 * sans, la couverture est typographique. Les tailles suivent la largeur de la couverture : la
 * même composition sert à la vignette d'une carte comme à l'aperçu en grand.
 */
export function BookCover({
  title,
  subtitle,
  author,
  label,
  imageUrl,
  seed,
  className,
}: BookCoverText & {
  /** Illustration de la couverture ; absente : couverture typographique. */
  imageUrl?: string | null;
  /** Ce qui identifie l'ouvrage (son identifiant) : il garde toujours la même reliure. */
  seed: string;
  className?: string;
}) {
  const palette = coverPalette(seed);
  const shown = title.trim() || 'Sans titre';
  const unit = (fraction: number) => `${(fraction * 100).toFixed(2)}cqw`;

  return (
    <div
      role="img"
      aria-label={`Couverture de « ${shown} »`}
      className={cn('relative isolate overflow-hidden rounded-[3px] bg-slate-900 text-left shadow-md ring-1 ring-black/15', className)}
      style={{ aspectRatio: '1 / 1.414', containerType: 'inline-size', background: palette.background }}
    >
      {imageUrl ? (
        <>
          <img src={imageUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
          <span
            aria-hidden="true"
            className="absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, rgba(15,23,42,.94) 0%, rgba(15,23,42,.8) 36%, rgba(15,23,42,0) 62%, rgba(15,23,42,0) 80%, rgba(15,23,42,.8) 100%)' }}
          />
        </>
      ) : (
        <>
          <span aria-hidden="true" className="absolute inset-0" style={{ background: `radial-gradient(120% 75% at 90% 102%, ${palette.accent}55, transparent 62%)` }} />
          {[0.68, 1].map((size) => (
            <span
              key={size}
              aria-hidden="true"
              className="absolute rounded-full"
              style={{ width: unit(size), height: unit(size), right: unit(0.14 - size / 2), bottom: unit(0.226 - size / 2), border: `0.4cqw solid ${palette.accent}40` }}
            />
          ))}
        </>
      )}

      <span className="absolute inset-0 flex flex-col" style={{ padding: `${unit(0.106)} ${unit(0.08)} ${unit(0.07)}` }}>
        <span aria-hidden="true" className="shrink-0" style={{ height: unit(0.012), width: unit(0.12), background: imageUrl ? '#fff' : palette.accent }} />
        {label && (
          <span className="shrink-0 font-bold uppercase text-white/80" style={{ fontSize: unit(0.03), letterSpacing: '0.18em', marginTop: unit(0.04) }}>
            {label}
          </span>
        )}
        <span
          className="font-display font-extrabold text-white [overflow-wrap:anywhere]"
          style={{ fontSize: unit(coverTitleScale(shown)), lineHeight: 1.1, marginTop: unit(label ? 0.03 : 0.04), display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 6, overflow: 'hidden' }}
        >
          {shown}
        </span>
        {subtitle?.trim() && (
          <span
            className="font-medium text-slate-200"
            style={{ fontSize: unit(0.036), lineHeight: 1.4, marginTop: unit(0.02), display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 4, overflow: 'hidden' }}
          >
            {subtitle}
          </span>
        )}
        {author?.trim() && (
          <span className="mt-auto truncate font-semibold text-white" style={{ fontSize: unit(0.038) }}>
            {author}
          </span>
        )}
      </span>

      {/* Le dos du livre : une ombre le long du bord gauche. */}
      <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-gradient-to-r from-black/40 to-transparent" style={{ width: unit(0.045) }} />
    </div>
  );
}
