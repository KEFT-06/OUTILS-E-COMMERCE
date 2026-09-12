import React from 'react';
import { TauxLevel } from '../../types/analysis';
import { TrendingUp, TrendingDown, Minus, CheckCircle2, AlertTriangle, Flame, ShieldAlert } from 'lucide-react';

interface RateBadgeProps {
  level: TauxLevel;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
}

export const RateBadge: React.FC<RateBadgeProps> = ({ level, size = 'md', showIcon = true }) => {
  const getConfig = () => {
    switch (level) {
      case 'Très élevé':
        return {
          bg: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-400',
          indicator: 'bg-emerald-500',
          icon: Flame,
          label: 'Très élevé',
        };
      case 'Élevé':
        return {
          bg: 'bg-blue-500/10 text-blue-700 border-blue-500/25 dark:text-blue-400',
          indicator: 'bg-blue-500',
          icon: TrendingUp,
          label: 'Élevé',
        };
      case 'Moyen':
        return {
          bg: 'bg-amber-500/10 text-amber-700 border-amber-500/25 dark:text-amber-400',
          indicator: 'bg-amber-500',
          icon: AlertTriangle,
          label: 'Moyen',
        };
      case 'Faible':
        return {
          bg: 'bg-rose-500/10 text-rose-700 border-rose-500/25 dark:text-rose-400',
          indicator: 'bg-rose-500',
          icon: ShieldAlert,
          label: 'Faible',
        };
      default:
        return {
          bg: 'bg-slate-500/10 text-slate-700 border-slate-500/25',
          indicator: 'bg-slate-500',
          icon: Minus,
          label: level,
        };
    }
  };

  const config = getConfig();
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5 font-semibold',
    lg: 'text-sm px-3.5 py-1.5 gap-2 font-bold',
  }[size];

  return (
    <span
      className={`inline-flex items-center rounded-full border ${config.bg} ${sizeClasses} transition-all duration-200`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.indicator} animate-pulse`} />
      {showIcon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      <span>{config.label}</span>
    </span>
  );
};
