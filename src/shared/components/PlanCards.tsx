import type { ReactNode } from 'react';
import { Bookmark, Check, Languages, Megaphone, Minus, Zap } from 'lucide-react';
import { formatMoney } from '@server/shared/currency';
import { formatPlanPrice, planIncludes } from '@/shared/lib/plans';
import { cn } from '@/shared/lib/utils';
import type { FeatureId, PlanCatalog, PlanDefinition, PlanId } from '@/shared/types/auth';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * Paliers d'abonnement, une carte par forfait : prix dans la devise du pays,
 * points, limites et fonctions incluses. Utilisé par l'accueil et par Mon compte.
 */

const FEATURE_ORDER: FeatureId[] = [
  'niche_analysis',
  'ai_writing',
  'radar_scan',
  'ad_gallery_scan',
  'image_generation',
  'video_generation',
  'storybook_generation',
  'affiliate_invitations',
  'native_review',
];

function Offer({ included, icon: Icon, children }: { included: boolean; icon?: typeof Check; children: ReactNode }) {
  const Glyph = Icon ?? (included ? Check : Minus);
  return (
    <li className={cn('flex items-start gap-2.5 text-sm', !included && 'text-muted-foreground')}>
      <Glyph
        className={cn('mt-0.5 size-4 shrink-0', included ? 'text-brand-green-text' : 'text-muted-foreground/70')}
        aria-hidden="true"
      />
      <span>
        {children}
        {!included && <span className="sr-only"> (non inclus)</span>}
      </span>
    </li>
  );
}

function PlanCard({
  plan,
  catalog,
  isCurrent,
  action,
}: {
  plan: PlanDefinition;
  catalog: PlanCatalog;
  isCurrent: boolean;
  action?: ReactNode;
}) {
  const total = catalog.adFrameworksTotal;
  const { savedNiches, adFrameworks, guideLanguages } = plan.limits;
  const freeMonths = 12 - catalog.pricing.yearlyMonthsCharged;

  return (
    <Card
      className={cn(
        'relative flex h-full flex-col gap-5',
        plan.highlight && 'border-primary ring-1 ring-primary/30',
        isCurrent && 'bg-accent/40',
      )}
    >
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-display text-xl font-extrabold">
            <h3>{plan.label}</h3>
          </CardTitle>
          {isCurrent ? (
            <Badge variant="success">Votre palier</Badge>
          ) : plan.highlight ? (
            <Badge variant="brand">Conseillé</Badge>
          ) : null}
        </div>
        {plan.tagline && <CardDescription>{plan.tagline}</CardDescription>}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5">
        <div className="space-y-1">
          <p className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-display text-3xl font-black tracking-tight tabular-nums">{formatPlanPrice(plan)}</span>
            {plan.price && plan.price.monthly > 0 && <span className="text-sm text-muted-foreground">/ mois</span>}
          </p>
          {plan.price && plan.price.monthly > 0 ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              ou {formatMoney(plan.price.yearly, plan.price.currency)} / an
              {freeMonths > 0 && ` · ${freeMonths} mois offerts`}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{plan.price ? 'Sans carte bancaire' : 'Tarif en préparation'}</p>
          )}
        </div>

        <ul className="space-y-2.5" aria-label={`Offres du palier ${plan.label}`}>
          <Offer included icon={Zap}>
            {plan.monthlyCredits === null ? (
              <strong className="font-semibold">Points illimités</strong>
            ) : (
              <>
                <strong className="font-semibold tabular-nums">{plan.monthlyCredits}</strong> points de recherche par mois
              </>
            )}
          </Offer>
          <Offer included icon={Bookmark}>
            {savedNiches === null ? (
              'Niches enregistrées illimitées'
            ) : (
              <>
                <strong className="font-semibold tabular-nums">{savedNiches}</strong> niche{savedNiches > 1 ? 's' : ''} enregistrée
                {savedNiches > 1 ? 's' : ''}
              </>
            )}
          </Offer>
          <Offer included icon={Megaphone}>
            {adFrameworks === null || adFrameworks >= total ? (
              `Les ${total} méthodes publicitaires`
            ) : (
              <>
                <strong className="font-semibold tabular-nums">{adFrameworks}</strong> méthodes publicitaires sur {total}
              </>
            )}
          </Offer>
          <Offer included icon={Languages}>
            {guideLanguages === null ? (
              'Guides traduits dans toutes les langues'
            ) : (
              <>
                Guides traduits en <strong className="font-semibold tabular-nums">{guideLanguages}</strong> langue{guideLanguages > 1 ? 's' : ''}
              </>
            )}
          </Offer>
          {FEATURE_ORDER.map((feature) => (
            <Offer key={feature} included={planIncludes(plan, feature)}>
              {catalog.features[feature]}
            </Offer>
          ))}
        </ul>
      </CardContent>

      {action && <CardFooter className="mt-auto">{action}</CardFooter>}
    </Card>
  );
}

export function PlanCards({
  catalog,
  currentPlanId,
  renderAction,
  className,
}: {
  catalog: PlanCatalog | null;
  currentPlanId?: PlanId;
  renderAction?: (plan: PlanDefinition, isCurrent: boolean) => ReactNode;
  className?: string;
}) {
  const converted = catalog?.plans.some((plan) => plan.price?.converted) ?? false;

  return (
    <div className={cn('space-y-4', className)}>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5" aria-busy={!catalog}>
        {catalog
          ? catalog.plans.map((plan) => {
              const isCurrent = plan.id === currentPlanId;
              return (
                <li key={plan.id} className="min-w-0">
                  <PlanCard plan={plan} catalog={catalog} isCurrent={isCurrent} action={renderAction?.(plan, isCurrent)} />
                </li>
              );
            })
          : Array.from({ length: 5 }, (_, index) => (
              <li key={index}>
                <Skeleton className="h-[26rem] rounded-xl" />
              </li>
            ))}
      </ul>
      {catalog && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {catalog.pricing.status ? `${catalog.pricing.status} ` : ''}
          {converted &&
            `Montants en ${catalog.currency} convertis au taux du ${new Date(catalog.pricing.ratesUpdatedAt).toLocaleDateString('fr-FR')} (ExchangeRate-API), arrondis.`}
        </p>
      )}
    </div>
  );
}
