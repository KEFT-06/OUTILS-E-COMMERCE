import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Radar } from 'lucide-react';
import { pathOf } from '@/app/navigation';
import { apiRequest } from '@/shared/lib/api';
import { formatRelativeFr } from '@/shared/lib/formatDate';
import { useRadarUnread } from '@/shared/stores/useRadarUnread';
import type { RadarDashboard } from '@/shared/types/radar';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

/**
 * Ce que le radar a vu, sur l'écran d'accueil.
 *
 * Le radar relève la nuit, quand personne ne regarde. Sans ce bloc, un créateur qui se connecte
 * le matin n'a aucune raison d'aller voir : la pastille de la barre latérale n'y supplée qu'à
 * moitié, et sur téléphone la barre est repliée.
 *
 * Il ne montre rien du tout quand il n'y a rien à montrer — ni surveillance, ni événement. Un
 * bloc qui affiche « aucun changement » chaque matin apprend à l'utilisateur à ne plus le lire.
 */

/** Trois lignes : de quoi donner envie d'ouvrir le radar, pas de le remplacer. */
const APERCU = 3;

export function RadarDigestCard() {
  const [data, setData] = useState<RadarDashboard | null>(null);
  // Compteur exact et déjà mutualisé avec les barres de navigation : le déduire de la liste
  // tronquée plafonnerait la pastille à cinq, quel que soit le nombre réel de nouveautés.
  const nonLus = useRadarUnread();

  useEffect(() => {
    let cancelled = false;
    // Trois lignes affichées : on ne demande que ce qui sera montré, plus une marge.
    apiRequest<RadarDashboard>('/api/radar?events=5')
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      // Complément de l'accueil : s'il échoue, le Cockpit reste entier.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || data.watches.length === 0 || data.events.length === 0) return null;

  const surveillees = data.watches.filter((watch) => watch.active).length;
  // Somme des compteurs de la semaine, la seule mesure fiable du volume ici.
  const semaine = Object.values(data.countsLast7Days).reduce((total, n) => total + (n ?? 0), 0);

  return (
    <Card className="lg:col-span-12">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radar className="size-4 shrink-0 text-brand-green-text" aria-hidden="true" />
          Ce que le radar a vu
          {nonLus > 0 && (
            <span className="rounded-full bg-brand-green-text px-2 py-0.5 text-xs font-semibold text-white">
              {nonLus > 99 ? '99+' : nonLus} nouveau{nonLus > 1 ? 'x' : ''}
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {surveillees} boutique{surveillees > 1 ? 's' : ''} surveillée{surveillees > 1 ? 's' : ''}, relevées chaque jour
          sans que vous ouvriez le site.
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link to={pathOf('radar')}>
              Ouvrir le radar
              <ArrowUpRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {data.events.slice(0, APERCU).map((event) => (
            <li key={event.id} className="py-2.5">
              {/* La phrase est celle rédigée par le serveur : l'accueil, l'écran Radar et
                  l'e-mail disent donc exactement la même chose. */}
              <p className="text-sm leading-relaxed break-words">{event.summary}</p>
              <p className="text-xs text-muted-foreground">
                {event.watchLabel} · {formatRelativeFr(event.occurredAt)}
              </p>
            </li>
          ))}
        </ul>
        {/*
          Le total vient des compteurs de la semaine, PAS de la longueur de la liste : celle-ci
          est volontairement tronquée à cinq pour ne pas alourdir l'écran d'accueil. La compter
          annoncerait « et 2 autres » là où il y en a quarante.
        */}
        {semaine > APERCU && (
          <p className="pt-3 text-xs text-muted-foreground">
            {semaine} changements en tout ces sept derniers jours.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
