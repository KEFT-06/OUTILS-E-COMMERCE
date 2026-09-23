import { useEffect, useState } from 'react';
import { Banknote, Lock } from 'lucide-react';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

/**
 * Grille tarifaire, en lecture seule.
 *
 * Deux tables décident de ce que rapporte le produit : ce qu'un palier DONNE et ce que chaque
 * action COÛTE en points. Elles vivaient dans deux fichiers de configuration qu'aucun écran ne
 * montrait — donc que personne ne relisait, et dont les incohérences ne se voyaient qu'à l'usage.
 *
 * Rien ne s'édite ici, et c'est un choix : les fichiers restent modifiables sans redéploiement,
 * mais une grille changée depuis une page web le serait sans trace ni relecture.
 */

interface Pricing {
  version: string;
  updatedAt: string;
  status: string | null;
  baseCurrency: string;
  yearlyMonthsCharged: number;
  point: { value: number; currency: string; status: string | null };
  features: Record<string, string>;
  adFrameworksTotal: number;
  plans: {
    id: string;
    label: string;
    tagline: string | null;
    highlight: boolean;
    monthlyCredits: number | null;
    prices: { currency: string; monthly: number }[];
    limits: Record<string, number | null>;
    closedFeatures: { id: string; label: string }[];
  }[];
  actions: { id: string; label: string; cost: number; perUnit: number | null; unitLabel: string | null }[];
}

/** Libellés des limites, dans l'ordre où elles racontent le parcours : voir, suivre, produire. */
const LIMITES: { key: string; label: string; suffixe?: (total: number) => string }[] = [
  { key: 'spiedAdsVisible', label: 'Annonces du mur d’espionnage' },
  { key: 'watchedStores', label: 'Boutiques surveillées par le radar' },
  { key: 'savedNiches', label: 'Niches enregistrées' },
  { key: 'adFrameworks', label: 'Méthodes publicitaires', suffixe: (total) => ` sur ${total}` },
  { key: 'guideLanguages', label: 'Langues par guide' },
  { key: 'ebookPages', label: 'Pages par ebook' },
];

const valeur = (v: number | null | undefined) => (v === null || v === undefined ? 'illimité' : v.toLocaleString('fr-FR'));

export function AdminPricingPage() {
  const [data, setData] = useState<Pricing | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<Pricing>('/api/admin/pricing')
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setErreur(toApiError(caught, 'La grille tarifaire n’a pas pu être chargée.').message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (erreur) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Administration" title="Tarifs" />
        <Alert variant="destructive">
          <AlertTitle>Grille indisponible</AlertTitle>
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Administration" title="Tarifs" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Tarifs"
        description={`Ce que chaque palier donne, et ce que chaque action coûte. Grille ${data.version}, mise à jour le ${data.updatedAt}.`}
      />

      {/* Les deux tables se déclarent provisoires tant qu'elles n'ont pas été validées
          commercialement : le dire ici évite de les prendre pour des prix arrêtés. */}
      {(data.status || data.point.status) && (
        <Alert variant="warning">
          <AlertTitle>Valeurs à confirmer</AlertTitle>
          <AlertDescription className="space-y-1">
            {data.status && <p>{data.status}</p>}
            {data.point.status && <p>{data.point.status}</p>}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Ce que chaque palier donne
          </CardTitle>
          <CardDescription>
            Devise de base {data.baseCurrency} · un an payé d’avance est facturé {data.yearlyMonthsCharged} mois ·
            1 point ≈ {data.point.value.toLocaleString('fr-FR')} {data.point.currency}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-44">Palier</TableHead>
                {data.plans.map((plan) => (
                  <TableHead key={plan.id} className="text-right whitespace-nowrap">
                    {plan.label}
                    {plan.highlight && (
                      <Badge variant="secondary" className="ml-1.5">
                        mis en avant
                      </Badge>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Prix par mois</TableCell>
                {data.plans.map((plan) => (
                  <TableCell key={plan.id} className="text-right whitespace-nowrap">
                    {plan.prices.length === 0
                      ? '—'
                      : plan.prices.map((prix) => (
                          <span key={prix.currency} className="block">
                            {prix.monthly.toLocaleString('fr-FR')} {prix.currency}
                          </span>
                        ))}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Points par mois</TableCell>
                {data.plans.map((plan) => (
                  <TableCell key={plan.id} className="text-right tabular-nums">
                    {valeur(plan.monthlyCredits)}
                  </TableCell>
                ))}
              </TableRow>
              {LIMITES.map((limite) => (
                <TableRow key={limite.key}>
                  <TableCell className="font-medium">
                    {limite.label}
                    {limite.suffixe && (
                      <span className="text-xs text-muted-foreground">{limite.suffixe(data.adFrameworksTotal)}</span>
                    )}
                  </TableCell>
                  {data.plans.map((plan) => (
                    <TableCell key={plan.id} className="text-right tabular-nums">
                      {valeur(plan.limits[limite.key])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {Object.entries(data.features).map(([id, label]) => (
                <TableRow key={id}>
                  <TableCell className="font-medium">{label}</TableCell>
                  {data.plans.map((plan) => {
                    const ferme = plan.closedFeatures.some((fonction) => fonction.id === id);
                    return (
                      <TableCell key={plan.id} className="text-right">
                        {ferme ? (
                          <Lock className="ml-auto size-4 text-muted-foreground" aria-label="Fermé" />
                        ) : (
                          <span aria-label="Ouvert" className="text-brand-green-text">
                            ✓
                          </span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ce que chaque action coûte</CardTitle>
          <CardDescription>
            En points, quel que soit le palier. C’est cette table qui décide de ce qu’un quota mensuel permet vraiment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead className="text-right">Équivalent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...data.actions]
                .sort((a, b) => b.cost - a.cost)
                .map((action) => (
                  <TableRow key={action.id}>
                    <TableCell>
                      <p className="font-medium">{action.label}</p>
                      {action.perUnit && (
                        <p className="text-xs text-muted-foreground">
                          par tranche de {action.perUnit} {action.unitLabel}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{action.cost}</TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap text-muted-foreground">
                      ≈ {(action.cost * data.point.value).toLocaleString('fr-FR')} {data.point.currency}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Lecture seule. Les deux tables sont des fichiers de configuration modifiables sans redéploiement
        (<code>server/config/plans.json</code> et <code>server/config/credit-costs.json</code>) : les éditer depuis une
        page web les changerait sans trace ni relecture.
      </p>
    </div>
  );
}
