import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bookmark, Check, LogOut, Pencil, ShieldCheck, Zap } from 'lucide-react';
import { initialsOf, useAuth } from '@/features/auth/AuthContext';
import { PageHeader } from '@/shared/components/PageHeader';
import { PLANS, formatPlanQuota, planOf } from '@/shared/lib/plans';
import { cn } from '@/shared/lib/utils';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty';
import { Input } from '@/shared/ui/input';
import { Progress } from '@/shared/ui/progress';
import { Separator } from '@/shared/ui/separator';

interface AccountViewProps {
  onSelectSavedNiche: (nicheQuery: string) => void;
}

function formatMonthYear(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

export function AccountView({ onSelectSavedNiche }: AccountViewProps) {
  const { user, logout, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(user?.name ?? '');

  if (!user) return null;

  const plan = planOf(user.plan);
  const used = user.apiSearchesUsed;
  const limit = user.apiSearchesLimit;
  const remaining = Math.max(0, limit - used);
  const remainingPct = limit > 0 ? (remaining / limit) * 100 : 0;

  const saveName = () => {
    const clean = draftName.trim();
    if (clean.length >= 2) updateProfile({ name: clean });
    setIsEditing(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Mon compte" description="Profil, points de recherche et palier d’abonnement." />

      <Card>
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar className="size-16 rounded-xl">
            <AvatarFallback className="rounded-xl bg-accent text-lg font-semibold text-accent-foreground">
              {initialsOf(user.name)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-2">
            {isEditing ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveName();
                }}
              >
                <Input
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setIsEditing(false);
                  }}
                  aria-label="Nom"
                  className="max-w-xs"
                  autoFocus
                />
                <Button type="submit" size="sm">
                  <Check />
                  Enregistrer
                </Button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="truncate font-display text-2xl font-extrabold tracking-tight">{user.name}</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Modifier le nom"
                  onClick={() => {
                    setDraftName(user.name);
                    setIsEditing(true);
                  }}
                >
                  <Pencil />
                </Button>
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              {user.email || 'Compte de démonstration : aucune adresse enregistrée.'}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Palier {user.plan}</Badge>
              {user.isDemo && <Badge variant="outline">Démonstration</Badge>}
              <span className="text-xs text-muted-foreground">Membre depuis {formatMonthYear(user.joinedAt)}</span>
            </div>
          </div>

          <Button
            variant="outline"
            className="self-start sm:self-center"
            onClick={() => {
              logout();
              navigate('/');
            }}
          >
            <LogOut />
            Se déconnecter
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-4 text-brand-orange-text" aria-hidden="true" />
              Points de recherche
            </CardTitle>
            <CardDescription>Palier {plan.id} : {formatPlanQuota(plan)}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-extrabold tabular-nums">{remaining}</span>
              <span className="text-sm text-muted-foreground">/ {limit} points restants</span>
            </p>
            <Progress value={remainingPct} aria-label="Points restants" />
            <p className="text-sm text-muted-foreground">
              {used} point{used > 1 ? 's' : ''} utilisé{used > 1 ? 's' : ''} sur ce cycle. Le coût de chaque action
              s’affiche avant validation.
            </p>
            <Separator />
            <div className="space-y-1.5">
              <Button disabled className="w-full">
                Recharger le solde
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Disponible avec l’ouverture du paiement en ligne.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bookmark className="size-4 text-brand-green-text" aria-hidden="true" />
              Niches enregistrées
            </CardTitle>
            <CardDescription>Relancez une analyse en un clic.</CardDescription>
          </CardHeader>
          <CardContent>
            {user.savedNiches.length === 0 ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyTitle>Aucune niche enregistrée</EmptyTitle>
                  <EmptyDescription>Les niches que vous suivez apparaîtront ici.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="space-y-2">
                {user.savedNiches.map((niche) => (
                  <li key={niche}>
                    <Button
                      variant="outline"
                      className="h-auto w-full justify-between py-3 text-left font-medium whitespace-normal"
                      onClick={() => onSelectSavedNiche(niche)}
                    >
                      {niche}
                      <ArrowRight />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Paliers d’abonnement</CardTitle>
          <CardDescription>
            Chaque palier fixe un quota mensuel de points. Les prix seront affichés à l’ouverture des abonnements.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {PLANS.map((candidate) => {
              const isCurrent = candidate.id === user.plan;
              return (
                <li
                  key={candidate.id}
                  className={cn(
                    'rounded-lg border p-4',
                    isCurrent ? 'border-primary bg-accent/60 ring-1 ring-primary/30' : 'bg-background',
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold">{candidate.id}</span>
                    {isCurrent && <Check className="size-4 text-brand-green-text" aria-label="Palier actuel" />}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground tabular-nums">{formatPlanQuota(candidate)}</p>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-brand-green-text" aria-hidden="true" />
            Connexions et partage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <div className="flex items-start justify-between gap-4 pb-4">
              <dt>
                <span className="block text-sm font-medium">Comptes publicitaires connectés</span>
                <span className="text-sm text-muted-foreground">
                  Connexion par OAuth officiel uniquement, révocable à tout moment.
                </span>
              </dt>
              <dd className="shrink-0 text-sm text-muted-foreground">Aucun</dd>
            </div>
            <div className="flex items-start justify-between gap-4 pt-4">
              <dt>
                <span className="block text-sm font-medium">Boucle de performance</span>
                <span className="text-sm text-muted-foreground">
                  Partage anonymisé de vos ventes, publié seulement à partir de 5 vendeurs.
                </span>
              </dt>
              <dd className="shrink-0 text-sm text-muted-foreground">Désactivée</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
