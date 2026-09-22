import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radar } from 'lucide-react';
import { pathOf } from '@/app/navigation';
import { apiRequest } from '@/shared/lib/api';
import { formatRelativeFr } from '@/shared/lib/formatDate';
import type { RadarMeasurements } from '@/shared/types/radar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

/**
 * Le pont entre le radar et l'analyse stratégique.
 *
 * Les cinq taux d'un rapport sont des APPRÉCIATIONS : l'IA les déduit de sources web. Ce
 * panneau affiche, à côté, ce qui a été COMPTÉ sur les boutiques réellement surveillées.
 *
 * Il se pose à côté du rapport, jamais dedans. Un rapport est un document daté, exporté en
 * PDF, sans date de modification : y verser des chiffres qui changent chaque nuit rendrait
 * tout export invérifiable — un lecteur ne saurait plus à quelle date le document dit vrai.
 *
 * Sans surveillance active, ce panneau ne s'affiche pas du tout : mieux vaut ne rien dire
 * que d'afficher des zéros qui passeraient pour un marché vide.
 */

export function RadarMeasuredPanel() {
  const [data, setData] = useState<RadarMeasurements | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<RadarMeasurements>('/api/radar/measurements')
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      // Le radar est un complément : s'il ne répond pas, l'analyse reste lisible et
      // ce panneau disparaît en silence.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || data.stores === 0) return null;

  const ventes = data.salesByCurrency[0] ?? null;
  const prix = data.medianPriceByCurrency[0] ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radar className="size-4 shrink-0 text-brand-green-text" aria-hidden="true" />
          Mesuré par le radar
        </CardTitle>
        <CardDescription>
          Compté sur {data.stores} boutique{data.stores > 1 ? 's' : ''} surveillée{data.stores > 1 ? 's' : ''} depuis{' '}
          {data.observedDays} jour{data.observedDays > 1 ? 's' : ''}
          {data.lastSweptAt ? `, dernier relevé ${formatRelativeFr(data.lastSweptAt)}` : ''}. Ces chiffres ne viennent pas de
          l’IA : ils sont relevés.
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link to={pathOf('radar')}>Ouvrir le radar</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Offres en vente</dt>
            <dd className="font-display text-2xl font-bold">{data.liveOffers}</dd>
            <p className="text-xs text-muted-foreground">la saturation, comptée</p>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Offres retirées</dt>
            <dd className="font-display text-2xl font-bold">{data.endedOffers}</dd>
            <p className="text-xs text-muted-foreground">depuis le début du suivi</p>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Ventes constatées</dt>
            <dd className="font-display text-2xl font-bold">{ventes ? ventes.units.toLocaleString('fr-FR') : '—'}</dd>
            <p className="text-xs text-muted-foreground">
              {data.salesPerDay === null ? 'vitesse après 2 jours de suivi' : `soit ${data.salesPerDay} par jour`}
            </p>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Prix médian</dt>
            <dd className="font-display text-2xl font-bold">
              {prix ? `${prix.price.toLocaleString('fr-FR')} ${prix.currency}` : '—'}
            </dd>
            <p className="text-xs text-muted-foreground">sur ce qui est en vente</p>
          </div>
        </dl>

        {ventes && ventes.revenue > 0 && (
          <p className="text-sm text-muted-foreground">
            Chiffre d’affaires visible sur la période :{' '}
            <strong className="text-foreground">
              {ventes.revenue.toLocaleString('fr-FR')} {ventes.currency}
            </strong>{' '}
            — prix affiché × ventes constatées pendant la surveillance.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Relevé, pas estimé</Badge>
          <span className="text-xs text-muted-foreground">
            Les ventes comptées sont celles réalisées depuis la mise sous surveillance. Ce que les boutiques avaient vendu
            avant n’est pas compté : le radar ne l’a pas vu.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
