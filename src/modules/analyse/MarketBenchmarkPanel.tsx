import { useEffect, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { apiRequest } from '@/shared/lib/api';
import { formatDateFr } from '@/shared/lib/formatDate';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

/**
 * Référence marché international d'une niche, à côté du rapport — jamais dedans.
 *
 * Ce panneau existe pour répondre à une question que l'analyse ne peut qu'apprécier : « combien
 * de gens vendent déjà ça, et depuis quand ? ». Ce sont des comptages, pas un avis.
 *
 * Il dit aussi, explicitement, ce qu'il ne mesure pas. Le prix médian affiché est celui d'un
 * marché international en dollars ; il ne dit pas à quel prix vendre en Afrique — c'est le radar
 * qui mesure les prix locaux. Laisser croire l'inverse conduirait un créateur à fixer un prix
 * dix fois trop haut pour son marché.
 */

interface Benchmark {
  query: string;
  source: string;
  productCount: number;
  medianPrice: number | null;
  currency: string | null;
  medianAgeDays: number | null;
  totalRatings: number;
  salesKnownCount: number;
  medianSales: number | null;
  collectedAt: string;
  freshForDays: number;
}

interface Result {
  benchmark: Benchmark | null;
  origin: 'cache' | 'collected' | 'capped' | 'unavailable';
}

export function MarketBenchmarkPanel({ niche }: { niche: string }) {
  const [data, setData] = useState<Result | null>(null);

  useEffect(() => {
    if (!niche.trim()) return;
    let cancelled = false;
    apiRequest<Result>('/api/market/benchmark', { method: 'POST', body: { niche } })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      // Complément : s'il manque, l'analyse reste lisible et ce panneau disparaît.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [niche]);

  const mesure = data?.benchmark;
  if (!mesure || mesure.productCount === 0) return null;

  const perimee = mesure.freshForDays === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Ce qui existe déjà, ailleurs
        </CardTitle>
        <CardDescription>
          {mesure.productCount} produits comptés sur Gumroad pour « {mesure.query} », relevé le{' '}
          {formatDateFr(mesure.collectedAt)}
          {perimee ? ' — mesure à rafraîchir' : ''}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Offres concurrentes</dt>
            <dd className="font-display text-2xl font-bold">{mesure.productCount}</dd>
            <p className="text-xs text-muted-foreground">la saturation, comptée</p>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Âge médian</dt>
            <dd className="font-display text-2xl font-bold">
              {mesure.medianAgeDays === null ? '—' : `${mesure.medianAgeDays} j`}
            </dd>
            <p className="text-xs text-muted-foreground">
              {mesure.medianAgeDays !== null && mesure.medianAgeDays > 365 ? 'niche installée' : 'niche jeune'}
            </p>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Avis cumulés</dt>
            <dd className="font-display text-2xl font-bold">{mesure.totalRatings.toLocaleString('fr-FR')}</dd>
            <p className="text-xs text-muted-foreground">plancher de ventes</p>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Prix médian international</dt>
            <dd className="font-display text-2xl font-bold">
              {mesure.medianPrice === null ? '—' : `${mesure.medianPrice.toLocaleString('fr-FR')} ${mesure.currency ?? ''}`}
            </dd>
            <p className="text-xs text-muted-foreground">pas un prix pour votre marché</p>
          </div>
        </dl>

        {mesure.salesKnownCount > 0 && mesure.medianSales !== null && (
          <p className="text-sm text-muted-foreground">
            Ventes médianes :{' '}
            <strong className="text-foreground">{mesure.medianSales.toLocaleString('fr-FR')}</strong> — sur les{' '}
            {mesure.salesKnownCount} produits qui publient leur compteur. Les autres le masquent.
          </p>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Compté, pas estimé</Badge>
            <span className="text-xs text-muted-foreground">
              Marché international en {mesure.currency ?? 'devise étrangère'}. Sert à savoir si un concept se vend et
              combien d’offres existent déjà.
            </span>
          </div>
          {/*
            L'avertissement le plus important de l'écran. Mesuré : prix médian 199,99 $ sur
            Gumroad contre 4 000 à 12 000 XAF chez les vendeurs africains. Sans cette phrase,
            un créateur fixerait son prix dix fois trop haut.
          */}
          <p className="text-xs text-amber-600 dark:text-amber-500">
            Ne recopiez pas ce prix : il vient d’un marché en devise forte. Pour savoir à quel prix vendre chez vous,
            fiez-vous aux boutiques que votre radar surveille.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
