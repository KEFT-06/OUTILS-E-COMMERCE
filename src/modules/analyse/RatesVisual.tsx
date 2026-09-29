import { RateBadge } from '@/shared/components/RateBadge';
import type { MarketRate, TauxLevel } from '@/shared/types/analysis';

/**
 * Les cinq taux en image : une jauge par taux et le profil de la niche en toile.
 *
 * Dessiné en SVG, sans bibliothèque de graphiques : l'onglet s'affiche instantanément, même sur
 * un petit téléphone. Les couleurs sont celles des niveaux, partout les mêmes dans l'outil ; un
 * taux non évalué reste gris et pointillé, jamais maquillé en zéro.
 */

const LEVEL_VALUE: Record<TauxLevel, number> = { Faible: 25, Moyen: 50, Élevé: 75, 'Très élevé': 95 };
const LEVEL_COLOR: Record<TauxLevel, string> = {
  Faible: 'var(--rate-low)',
  Moyen: 'var(--rate-medium)',
  Élevé: 'var(--rate-good)',
  'Très élevé': 'var(--rate-excellent)',
};
const SHORT: Record<MarketRate['key'], string> = {
  demand: 'Demande',
  saturation: 'Saturation',
  profitability: 'Rentabilité',
  opportunity: 'Opportunité',
  virality: 'Viralité',
};

/** Valeur sur 100 : le score calculé s'il existe, sinon le niveau. null : non évalué. */
function valueOf(rate: MarketRate): number | null {
  if (rate.score !== null) return Math.max(0, Math.min(100, rate.score));
  return rate.level ? LEVEL_VALUE[rate.level] : null;
}

function Gauge({ rate }: { rate: MarketRate }) {
  const value = valueOf(rate);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  // Trois quarts de cercle, ouverts en bas : on lit la jauge comme un cadran.
  const arc = circumference * 0.75;
  const filled = value === null ? 0 : (arc * value) / 100;
  const color = rate.level ? LEVEL_COLOR[rate.level] : 'var(--muted-foreground)';
  return (
    <figure className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-4 text-center shadow-sm">
      <svg viewBox="0 0 100 100" className="size-28" role="img" aria-label={`${rate.label} : ${rate.level ?? 'non évalué'}`}>
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
          transform="rotate(135 50 50)"
        />
        {value === null ? (
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth="2"
            strokeDasharray="3 5"
            transform="rotate(135 50 50)"
          />
        ) : (
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            transform="rotate(135 50 50)"
            className="transition-[stroke-dasharray] duration-700 ease-out"
          />
        )}
        <text x="50" y="52" textAnchor="middle" className="fill-foreground font-display text-[18px] font-extrabold">
          {rate.score !== null ? rate.score : value === null ? '—' : (rate.level ?? '')}
        </text>
        {rate.score !== null && (
          <text x="50" y="66" textAnchor="middle" className="fill-muted-foreground text-[8px]">
            sur 100
          </text>
        )}
      </svg>
      <figcaption className="space-y-1.5">
        <span className="block text-sm font-semibold">{SHORT[rate.key]}</span>
        <RateBadge level={rate.level} size="sm" />
      </figcaption>
    </figure>
  );
}

/** Profil de la niche : une toile à cinq branches, une par taux. */
function Profile({ rates }: { rates: MarketRate[] }) {
  const center = 110;
  const radius = 78;
  const point = (index: number, value: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / rates.length;
    return [center + Math.cos(angle) * radius * (value / 100), center + Math.sin(angle) * radius * (value / 100)] as const;
  };
  const polygon = rates.map((rate, index) => point(index, valueOf(rate) ?? 0).join(',')).join(' ');
  return (
    <svg viewBox="-30 -8 280 236" className="mx-auto w-full max-w-xs overflow-visible" role="img" aria-label="Profil de la niche sur les cinq taux">
      {[25, 50, 75, 100].map((ring) => (
        <polygon
          key={ring}
          points={rates.map((_, index) => point(index, ring).join(',')).join(' ')}
          fill="none"
          stroke="var(--border)"
          strokeWidth={ring === 100 ? 1.2 : 0.8}
        />
      ))}
      {rates.map((rate, index) => {
        const [x, y] = point(index, 100);
        const [lx, ly] = point(index, 124);
        return (
          <g key={rate.key}>
            <line x1={center} y1={center} x2={x} y2={y} stroke="var(--border)" strokeWidth="0.8" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[9.5px] font-medium">
              {SHORT[rate.key]}
            </text>
          </g>
        );
      })}
      <polygon points={polygon} fill="var(--brand-green)" fillOpacity="0.22" stroke="var(--brand-green)" strokeWidth="2" strokeLinejoin="round" />
      {rates.map((rate, index) => {
        const value = valueOf(rate);
        if (value === null) return null;
        const [x, y] = point(index, value);
        return <circle key={rate.key} cx={x} cy={y} r="3.5" fill={rate.level ? LEVEL_COLOR[rate.level] : 'var(--brand-green)'} stroke="var(--card)" strokeWidth="1.5" />;
      })}
    </svg>
  );
}

export function RatesVisual({ rates }: { rates: MarketRate[] }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-center">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {rates.map((rate) => (
            <Gauge key={rate.key} rate={rate} />
          ))}
        </div>
        <div className="rounded-2xl border bg-gradient-to-b from-muted/60 to-card p-4">
          <p className="mb-2 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase">Profil de la niche</p>
          <Profile rates={rates} />
        </div>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {rates.map((rate) => (
          <li key={rate.key} className="rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-semibold">{rate.label}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{rate.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
