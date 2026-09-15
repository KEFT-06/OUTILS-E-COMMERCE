import { findCountry } from '@server/shared/countries';
import { cn } from '@/shared/lib/utils';

/**
 * Drapeau d'un pays, en image servie par le site (public/flags).
 *
 * Pas d'émoji : Windows n'affiche pas les drapeaux émoji, seulement deux lettres.
 * Décoratif : le nom du pays est toujours écrit à côté.
 */
export function CountryFlag({ code, className }: { code: string | null | undefined; className?: string }) {
  const country = findCountry(code);
  const base = 'inline-block h-3.5 w-5 shrink-0 rounded-[3px] shadow-[0_0_0_1px_rgb(0_0_0/0.1)]';

  if (!country) return <span aria-hidden="true" className={cn(base, 'bg-muted', className)} />;

  return (
    <img
      src={`/flags/${country.code}.svg`}
      alt=""
      aria-hidden="true"
      width={20}
      height={14}
      loading="lazy"
      decoding="async"
      className={cn(base, 'object-cover', className)}
    />
  );
}
