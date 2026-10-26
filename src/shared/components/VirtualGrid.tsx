import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/shared/lib/utils';

/**
 * Grille qui ne fabrique que les rangées proches de l'écran.
 *
 * Mesuré le 26/10/2026 sur le mur de l'Espionnage (version construite, processeur de téléphone
 * milieu de gamme simulé) : 100 cartes fabriquées d'un coup, 8 626 éléments, 18,5 s avant que le
 * mur soit complet dont 8,5 s de page figée — alors qu'un téléphone n'en montre que deux à la fois.
 * Ici, seules les rangées visibles (et une marge) existent ; les autres sont créées au défilement.
 *
 * La page défile sur la fenêtre (vérifié à 390 et 1 366 px) : d'où le mode « fenêtre ». Les colonnes
 * suivent les points de rupture de Tailwind, comme la grille qu'elle remplace : 1, puis 2 dès
 * `sm`, 3 dès `xl`, 4 dès `2xl`. Les hauteurs de rangée sont mesurées, pas supposées : une carte
 * avec vidéo et une carte texte n'ont pas la même. Peu d'éléments : grille ordinaire, rien à gagner.
 */

const BREAKPOINTS: readonly [query: string, columns: number][] = [
  ['(min-width: 96rem)', 4],
  ['(min-width: 80rem)', 3],
  ['(min-width: 40rem)', 2],
];
const GAP_PX = 16;
/** En deçà, la grille ordinaire suffit. */
const PLAIN_UNDER = 12;

function columnsNow(): number {
  if (typeof window === 'undefined') return 1;
  return BREAKPOINTS.find(([query]) => window.matchMedia(query).matches)?.[1] ?? 1;
}

function useColumns(): number {
  const [columns, setColumns] = useState(columnsNow);
  useLayoutEffect(() => {
    const lists = BREAKPOINTS.map(([query]) => window.matchMedia(query));
    const update = () => setColumns(columnsNow());
    for (const list of lists) list.addEventListener('change', update);
    return () => {
      for (const list of lists) list.removeEventListener('change', update);
    };
  }, []);
  return columns;
}

export function VirtualGrid<T>({
  items,
  getKey,
  renderItem,
  estimateRowHeight = 480,
  className,
}: {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Hauteur supposée d'une rangée avant sa première mesure. */
  estimateRowHeight?: number;
  className?: string;
}) {
  const columns = useColumns();
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const rows = Math.ceil(items.length / columns);

  // Distance entre le haut de la page et la grille : ce qui la précède (filtres, titres) peut changer de hauteur.
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const measure = () => setScrollMargin(element.getBoundingClientRect().top + window.scrollY);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: rows,
    estimateSize: () => estimateRowHeight,
    overscan: 2,
    gap: GAP_PX,
    scrollMargin,
  });

  const gridClass = cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4', className);
  if (items.length <= PLAIN_UNDER) {
    return (
      <div className={gridClass}>
        {items.map((item) => (
          <div key={getKey(item)} className="min-w-0 [&>*]:h-full">
            {renderItem(item)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={listRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => {
        const rowItems = items.slice(row.index * columns, row.index * columns + columns);
        return (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className={cn(gridClass, 'absolute inset-x-0 top-0')}
            style={{ transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)` }}
          >
            {rowItems.map((item) => (
              <div key={getKey(item)} className="min-w-0 [&>*]:h-full">
                {renderItem(item)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
