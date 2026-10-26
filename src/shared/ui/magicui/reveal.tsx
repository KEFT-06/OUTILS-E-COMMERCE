import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * Apparition douce au défilement (d'après le BlurFade de Magic UI), sans la bibliothèque motion.
 *
 * Seul ce qui est encore SOUS l'écran au chargement est caché puis révélé : ce que le visiteur
 * voit déjà ne clignote jamais, et un robot d'indexation (grande fenêtre) lit tout. Rien n'est
 * animé avec « réduire les animations ».
 */
export function Reveal({ children, delayMs = 0, className }: { children: ReactNode; delayMs?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'waiting' | 'shown'>('idle');

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (element.getBoundingClientRect().top < window.innerHeight) return;
    setState('waiting');
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        setState('shown');
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        state !== 'idle' && 'transition-[opacity,transform,filter] duration-700 ease-out',
        state === 'waiting' && 'translate-y-4 opacity-0 blur-[3px]',
        className,
      )}
      style={state === 'shown' && delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}
