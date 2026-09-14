import { AlertTriangle, Flame, Minus, Search, ShieldAlert, TrendingUp } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { TauxLevel } from '@/shared/types/analysis';

/**
 * Niveau d'un taux. Les quatre couleurs de taux sont réservées à cet usage :
 * l'utilisateur doit pouvoir lire un score à sa couleur, partout. Le niveau est
 * aussi porté par une icône et un libellé, jamais par la couleur seule.
 */
interface RateBadgeProps {
  level: TauxLevel;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  /**
   * Rend le badge cliquable et ouvre le panneau de détail du calcul. Sans ce
   * handler, le badge reste un libellé — c'est le cas dans l'aperçu PDF.
   */
  onInspect?: () => void;
  /** Intitulé du taux, utilisé pour le libellé accessible du bouton. */
  inspectLabel?: string;
}

const LEVELS = {
  'Très élevé': {
    tone: 'border-rate-excellent/35 bg-rate-excellent/10 text-rate-excellent-text',
    dot: 'bg-rate-excellent',
    icon: Flame,
  },
  Élevé: {
    tone: 'border-rate-good/35 bg-rate-good/10 text-rate-good-text',
    dot: 'bg-rate-good',
    icon: TrendingUp,
  },
  Moyen: {
    tone: 'border-rate-medium/35 bg-rate-medium/10 text-rate-medium-text',
    dot: 'bg-rate-medium',
    icon: AlertTriangle,
  },
  Faible: {
    tone: 'border-rate-low/35 bg-rate-low/10 text-rate-low-text',
    dot: 'bg-rate-low',
    icon: ShieldAlert,
  },
} as const;

const SIZES = {
  sm: 'gap-1 px-2 py-0.5 text-xs',
  md: 'gap-1.5 px-2.5 py-1 text-xs font-semibold',
  lg: 'gap-2 px-3.5 py-1.5 text-sm font-semibold',
} as const;

export function RateBadge({ level, size = 'md', showIcon = true, onInspect, inspectLabel }: RateBadgeProps) {
  const config = LEVELS[level as keyof typeof LEVELS] ?? {
    tone: 'border-border bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground',
    icon: Minus,
  };
  const Icon = config.icon;

  const classes = cn('inline-flex items-center rounded-full border transition-colors', config.tone, SIZES[size]);

  const content = (
    <>
      <span className={cn('size-1.5 rounded-full', config.dot)} aria-hidden="true" />
      {showIcon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
      <span>{level}</span>
    </>
  );

  if (!onInspect) {
    return <span className={classes}>{content}</span>;
  }

  return (
    <button
      type="button"
      onClick={onInspect}
      aria-label={`Voir le détail du calcul : ${inspectLabel ?? level}`}
      title="Voir le détail du calcul"
      className={cn(classes, 'cursor-pointer hover:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none')}
    >
      {content}
      <Search className="size-3 shrink-0 opacity-70" aria-hidden="true" />
    </button>
  );
}
