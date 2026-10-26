import { useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * Chiffre qui défile jusqu'à sa valeur quand il entre à l'écran (d'après le NumberTicker de
 * Magic UI), sans la bibliothèque motion : l'accueil ne la charge pas au premier affichage.
 *
 * La valeur exacte est toujours lue par les lecteurs d'écran et sert de rendu sans animation
 * (« réduire les animations », navigateur sans IntersectionObserver) : seul l'affichage défile.
 */
export function NumberTicker({
  value,
  decimals = 0,
  suffix = '',
  durationMs = 1400,
  className,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  durationMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const format = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    setShown(0);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const step = (now: number) => {
          const progress = Math.min(1, (now - start) / durationMs);
          // Départ vif, arrivée douce.
          setShown(value * (1 - (1 - progress) ** 3));
          if (progress < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.6 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, durationMs]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden="true">{format(shown)}</span>
    </span>
  );
}
