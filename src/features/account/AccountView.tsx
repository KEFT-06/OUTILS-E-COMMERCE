import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  ArrowRight,
  Bookmark,
  Check,
  History,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  Pencil,
  PlugZap,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { initialsOf, useAuth } from '@/features/auth/AuthContext';
import { PASSWORD_MIN_LENGTH, PasswordHints, PasswordInput } from '@/features/auth/PasswordInput';
import { RecoveryCodesPanel, TwoFactorSetup } from '@/features/auth/TwoFactorSetup';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiRequest, passwordProblemsOf } from '@/shared/lib/api';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import { formatDateFr, formatRelativeFr } from '@/shared/lib/formatDate';
import { CREDIT_REASON_LABELS, labelOf } from '@/shared/lib/labels';
import { formatPlanPrice, formatPlanQuota, usePlans } from '@/shared/lib/plans';
import { cn } from '@/shared/lib/utils';
import type { Account, PlanId } from '@/shared/types/auth';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Progress } from '@/shared/ui/progress';
import { Separator } from '@/shared/ui/separator';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

interface AccountViewProps {
  onSelectSavedNiche: (nicheQuery: string) => void;
}

function formatMonthYear(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/* -------------------------------------------------------------------------- */
/*  Profil                                                                     */
/* -------------------------------------------------------------------------- */

function ProfileCard({ account }: { account: Account }) {
  const { logout, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(account.name);
  const [saving, setSaving] = useState(false);

  const saveName = async () => {
    const clean = draftName.trim();
    if (clean.length < 2 || clean === account.name) {
      setIsEditing(false);
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ name: clean });
      setIsEditing(false);
      toast.success('Nom enregistré');
    } catch (caught) {
      toast.error('Le nom n’a pas pu être enregistré', { description: toApiError(caught, 'Erreur inconnue.').message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <Avatar className="size-16 rounded-xl">
          <AvatarFallback className="rounded-xl bg-accent text-lg font-semibold text-accent-foreground">
            {initialsOf(account.name)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-2">
          {isEditing ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void saveName();
              }}
            >
              <Input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setIsEditing(false);
                }}
                aria-label="Nom"
                maxLength={80}
                className="max-w-xs"
                autoFocus
              />
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? <Spinner /> : <Check />}
                Enregistrer
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="truncate font-display text-2xl font-extrabold tracking-tight">{account.name}</h2>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Modifier le nom"
                onClick={() => {
                  setDraftName(account.name);
                  setIsEditing(true);
                }}
              >
                <Pencil />
              </Button>
            </div>
          )}

          <p className="text-sm text-muted-foreground">{account.email}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={account.plan.id === 'free' ? 'secondary' : 'brand'}>Palier {account.plan.label}</Badge>
            {account.role === 'admin' ? (
              <Badge variant="info">Administrateur</Badge>
            ) : account.isStaff ? (
              <Badge variant="outline">Équipe</Badge>
            ) : null}
            {account.twoFactor.enabled && <Badge variant="success">Double authentification</Badge>}
            <span className="text-xs text-muted-foreground">Membre depuis {formatMonthYear(account.createdAt)}</span>
          </div>
        </div>

        <Button
          variant="outline"
          className="self-start sm:self-center"
          onClick={() => {
            void logout().finally(() => navigate('/'));
          }}
        >
          <LogOut />
          Se déconnecter
        </Button>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Points                                                                     */
/* -------------------------------------------------------------------------- */

interface LedgerEntry {
  id: string;
  reason: string;
  actionId: string | null;
  delta: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

function CreditHistoryDialog() {
  const { costTable } = useCreditGate();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEntries(null);
    setError(null);
    apiRequest<{ entries: LedgerEntry[] }>('/api/account/credits')
      .then((result) => {
        if (!cancelled) setEntries(result.entries);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'L’historique n’a pas pu être chargé.'));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const actionLabel = (id: string) => costTable?.actions.find((action) => action.id === id)?.label ?? id;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <History />
          Historique
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Historique de vos points</DialogTitle>
          <DialogDescription>Les 50 derniers mouvements : un solde doit toujours pouvoir s’expliquer.</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="danger">
            <TriangleAlert />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : !entries ? (
          <div className="space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Mouvement</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead className="text-right">Solde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateFr(entry.createdAt, true)}</TableCell>
                  <TableCell className="whitespace-normal">
                    {labelOf(CREDIT_REASON_LABELS, entry.reason)}
                    {entry.actionId && <span className="text-muted-foreground"> · {actionLabel(entry.actionId)}</span>}
                    {entry.note && <span className="block text-xs text-muted-foreground">{entry.note}</span>}
                  </TableCell>
                  <TableCell
                    className={cn('text-right font-semibold tabular-nums', entry.delta > 0 && 'text-success', entry.delta < 0 && 'text-danger')}
                  >
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta < 0 ? `−${Math.abs(entry.delta)}` : '0'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{entry.balanceAfter}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreditsCard({ account }: { account: Account }) {
  const { credits } = account;
  const pct = credits.unlimited ? 100 : credits.allowance ? Math.min(100, (credits.plan / credits.allowance) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <Zap className="size-4 text-brand-orange-text" aria-hidden="true" />
            Points de recherche
          </h2>
        </CardTitle>
        <CardDescription>
          Palier {account.plan.label}
          {account.planExpiresAt ? `, jusqu’au ${formatDateFr(account.planExpiresAt)}` : ''}.
        </CardDescription>
        <CardAction>
          <CreditHistoryDialog />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="flex items-baseline gap-2">
          <span className="font-display text-4xl font-extrabold tabular-nums">{credits.unlimited ? '∞' : credits.total}</span>
          <span className="text-sm text-muted-foreground">{credits.unlimited ? 'points illimités' : 'points disponibles'}</span>
        </p>
        <Progress value={pct} aria-label="Quota mensuel restant" />
        {!credits.unlimited && (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground">Quota du mois</dt>
              <dd className="font-semibold tabular-nums">
                {credits.plan} / {credits.allowance ?? 0}
              </dd>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground">Points bonus</dt>
              <dd className="font-semibold tabular-nums">{credits.bonus}</dd>
            </div>
          </dl>
        )}
        <p className="text-sm text-muted-foreground">
          {credits.unlimited
            ? 'Votre palier ne décompte aucun point.'
            : `Quota rechargé le ${formatDateFr(credits.cycleEndsAt)} ; les points bonus n’expirent pas.`}{' '}
          Le coût de chaque action s’affiche avant validation, et une génération qui échoue vous rend ses points.
        </p>
        <Separator />
        <p className="text-center text-xs text-muted-foreground">
          Pour recharger votre solde ou changer de palier, contactez l’équipe Smart Creator : le paiement en ligne n’est pas encore ouvert.
        </p>
      </CardContent>
    </Card>
  );
}

function SavedNichesCard({ niches, onSelect }: { niches: string[]; onSelect: (niche: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <Bookmark className="size-4 text-brand-green-text" aria-hidden="true" />
            Niches enregistrées
          </h2>
        </CardTitle>
        <CardDescription>Relancez une analyse en un clic.</CardDescription>
      </CardHeader>
      <CardContent>
        {niches.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>Aucune niche enregistrée</EmptyTitle>
              <EmptyDescription>Les niches que vous suivez apparaîtront ici.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="space-y-2">
            {niches.map((niche) => (
              <li key={niche}>
                <Button
                  variant="outline"
                  className="h-auto w-full justify-between py-3 text-left font-medium whitespace-normal"
                  onClick={() => onSelect(niche)}
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
  );
}

function PlansCard({ currentPlanId }: { currentPlanId: PlanId }) {
  const { catalog } = usePlans();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Paliers d’abonnement</h2>
        </CardTitle>
        <CardDescription>Chaque palier fixe un quota mensuel de points. Un prix pas encore fixé est indiqué « Prix à venir ».</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {catalog
            ? catalog.plans.map((plan) => {
                const isCurrent = plan.id === currentPlanId;
                return (
                  <li
                    key={plan.id}
                    className={cn('rounded-lg border p-4', isCurrent ? 'border-primary bg-accent/60 ring-1 ring-primary/30' : 'bg-background')}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-semibold">{plan.label}</span>
                      {isCurrent && <Check className="size-4 text-brand-green-text" aria-label="Palier actuel" />}
                    </div>
                    <p className="mt-2 text-sm font-semibold tabular-nums">{formatPlanPrice(plan)}</p>
                    <p className="text-sm text-muted-foreground tabular-nums">{formatPlanQuota(plan)}</p>
                  </li>
                );
              })
            : Array.from({ length: 5 }, (_, index) => (
                <li key={index}>
                  <Skeleton className="h-24 rounded-lg" />
                </li>
              ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sécurité                                                                   */
/* -------------------------------------------------------------------------- */

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Indiquez votre mot de passe actuel.'),
    newPassword: z.string().min(PASSWORD_MIN_LENGTH, `${PASSWORD_MIN_LENGTH} caractères au moins.`).max(128),
    confirmation: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmation, {
    message: 'Les deux mots de passe ne correspondent pas.',
    path: ['confirmation'],
  });

function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const form = useForm<z.infer<typeof passwordChangeSchema>>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmation: '' },
  });
  const newPassword = form.watch('newPassword');
  const problems = passwordProblemsOf(error);

  const change = (next: boolean) => {
    setOpen(next);
    if (!next) {
      form.reset();
      setError(null);
    }
  };

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword: chosen }) => {
    setError(null);
    try {
      await apiRequest('/api/account/password', { method: 'POST', body: { currentPassword, newPassword: chosen } });
      toast.success('Mot de passe modifié', { description: 'Vos sessions sur les autres appareils ont été fermées.' });
      change(false);
    } catch (caught) {
      setError(toApiError(caught, 'Le mot de passe n’a pas pu être modifié.'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound />
          Changer le mot de passe
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Changer le mot de passe</DialogTitle>
            <DialogDescription>Vos autres appareils seront déconnectés ; celui-ci reste connecté.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {error && (
              <Alert variant="danger" role="alert">
                <TriangleAlert />
                <AlertTitle>{error.message}</AlertTitle>
                {problems.length > 1 && (
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {problems.slice(1).map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                )}
              </Alert>
            )}
            <input type="text" name="username" autoComplete="username" hidden readOnly />
            <Controller
              name="currentPassword"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="current-password">Mot de passe actuel</FieldLabel>
                  <PasswordInput {...field} id="current-password" autoComplete="current-password" aria-invalid={fieldState.invalid} />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Controller
              name="newPassword"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="new-password">Nouveau mot de passe</FieldLabel>
                  <PasswordInput {...field} id="new-password" autoComplete="new-password" aria-invalid={fieldState.invalid} />
                  <PasswordHints password={newPassword} />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Controller
              name="confirmation"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="confirm-password">Confirmez le nouveau mot de passe</FieldLabel>
                  <PasswordInput {...field} id="confirm-password" autoComplete="new-password" aria-invalid={fieldState.invalid} />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </FieldGroup>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => change(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Spinner />}
              Modifier
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CodeField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Code de votre application</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^\d\s]/g, '').slice(0, 7))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        className="h-11 max-w-44 text-center text-lg font-semibold tracking-[0.3em] tabular-nums"
      />
    </Field>
  );
}

function RegenerateRecoveryCodesDialog() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const change = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setCode('');
      setCodes(null);
      setError(null);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<{ recoveryCodes: string[] }>('/api/account/two-factor/recovery-codes', {
        method: 'POST',
        body: { code },
      });
      setCodes(result.recoveryCodes);
    } catch (caught) {
      setError(toApiError(caught, 'Les codes n’ont pas pu être renouvelés.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Nouveaux codes de secours
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouveaux codes de secours</DialogTitle>
          <DialogDescription>Les anciens codes cessent de fonctionner dès maintenant.</DialogDescription>
        </DialogHeader>
        {codes ? (
          <RecoveryCodesPanel codes={codes} onDone={() => change(false)} />
        ) : (
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <CodeField id="regenerate-code" value={code} onChange={setCode} />
            {error && (
              <Alert variant="danger" role="alert">
                <TriangleAlert />
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={busy || code.replace(/\s/g, '').length !== 6}>
              {busy && <Spinner />}
              Générer de nouveaux codes
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableTwoFactorDialog() {
  const { setAccount } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const change = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setPassword('');
      setCode('');
      setError(null);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<{ account: Account }>('/api/account/two-factor/disable', {
        method: 'POST',
        body: { password, code },
      });
      setAccount(result.account);
      toast.success('Double authentification désactivée');
      change(false);
    } catch (caught) {
      setError(toApiError(caught, 'La double authentification n’a pas pu être désactivée.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-danger hover:text-danger">
          Désactiver
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Désactiver la double authentification ?</DialogTitle>
            <DialogDescription>Votre mot de passe suffira de nouveau pour vous connecter : votre compte sera moins protégé.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <input type="text" name="username" autoComplete="username" hidden readOnly />
            <Field>
              <FieldLabel htmlFor="disable-password">Mot de passe</FieldLabel>
              <PasswordInput id="disable-password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            </Field>
            <CodeField id="disable-code" value={code} onChange={setCode} />
          </FieldGroup>
          {error && (
            <Alert variant="danger" role="alert">
              <TriangleAlert />
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => change(false)}>
              Garder la protection
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !password || code.replace(/\s/g, '').length !== 6}>
              {busy && <Spinner />}
              Désactiver
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface SessionItem {
  id: string;
  current: boolean;
  device: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  online: boolean;
}

function SessionsList() {
  const { setAccount } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ sessions: SessionItem[] }>('/api/account/sessions');
      setSessions(result.sessions);
      setError(null);
    } catch (caught) {
      setError(toApiError(caught, 'Les appareils n’ont pas pu être chargés.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (session: SessionItem) => {
    setBusy(session.id);
    try {
      await apiRequest(`/api/account/sessions/${session.id}/revoke`, { method: 'POST' });
      if (session.current) {
        setAccount(null);
        navigate('/connexion');
        return;
      }
      toast.success('Appareil déconnecté');
      await load();
    } catch (caught) {
      toast.error('Déconnexion impossible', { description: toApiError(caught, 'Erreur inconnue.').message });
    } finally {
      setBusy(null);
    }
  };

  const revokeOthers = async () => {
    setBusy('others');
    try {
      const result = await apiRequest<{ revoked: number }>('/api/account/sessions/revoke-others', { method: 'POST' });
      toast.success(result.revoked > 0 ? `${result.revoked} appareil(s) déconnecté(s)` : 'Aucun autre appareil connecté');
      await load();
    } catch (caught) {
      toast.error('Déconnexion impossible', { description: toApiError(caught, 'Erreur inconnue.').message });
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <Alert variant="danger">
        <TriangleAlert />
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }
  if (!sessions) return <Skeleton className="h-24" />;

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border">
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {session.device}
                  {session.current && <Badge variant="success">Cet appareil</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {session.ip ?? 'IP inconnue'} · active {formatRelativeFr(session.lastSeenAt)} · ouverte le {formatDateFr(session.createdAt)}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="self-start sm:self-center" onClick={() => void revoke(session)} disabled={busy !== null}>
              {busy === session.id && <Spinner />}
              {session.current ? 'Me déconnecter' : 'Déconnecter'}
            </Button>
          </li>
        ))}
      </ul>
      {sessions.length > 1 && (
        <Button variant="outline" size="sm" onClick={() => void revokeOthers()} disabled={busy !== null}>
          {busy === 'others' && <Spinner />}
          Déconnecter tous les autres appareils
        </Button>
      )}
    </div>
  );
}

function SecurityCard({ account }: { account: Account }) {
  return (
    <Card id="securite" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-brand-green-text" aria-hidden="true" />
            Sécurité
          </h2>
        </CardTitle>
        <CardDescription>Mot de passe, double authentification et appareils connectés.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section aria-labelledby="security-password" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 id="security-password" className="text-sm font-semibold">
              Mot de passe
            </h3>
            <p className="text-sm text-muted-foreground">Le changer ferme vos sessions sur les autres appareils.</p>
          </div>
          <ChangePasswordDialog />
        </section>

        <Separator />

        <section aria-labelledby="security-2fa" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="security-2fa" className="text-sm font-semibold">
              Double authentification
            </h3>
            {account.twoFactor.enabled ? <Badge variant="success">Activée</Badge> : <Badge variant="outline">Désactivée</Badge>}
          </div>
          {account.twoFactor.enabled ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Un code de votre application vous est demandé à chaque connexion.</p>
              <div className="flex flex-wrap gap-2">
                <RegenerateRecoveryCodesDialog />
                {!account.isStaff && <DisableTwoFactorDialog />}
              </div>
              {account.isStaff && (
                <p className="text-xs text-muted-foreground">Obligatoire pour les comptes qui détiennent des privilèges d’administration.</p>
              )}
            </div>
          ) : (
            <>
              {account.twoFactor.required && (
                <Alert variant="warning">
                  <TriangleAlert />
                  <AlertTitle>Obligatoire pour votre compte</AlertTitle>
                  <AlertDescription>Votre compte détient des privilèges d’administration : activez-la pour y accéder.</AlertDescription>
                </Alert>
              )}
              <TwoFactorSetup />
            </>
          )}
        </section>

        <Separator />

        <section aria-labelledby="security-sessions" className="space-y-3">
          <h3 id="security-sessions" className="text-sm font-semibold">
            Appareils connectés
          </h3>
          <SessionsList />
        </section>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Connexions                                                                 */
/* -------------------------------------------------------------------------- */

function ConnectionsCard({ account }: { account: Account }) {
  const { refresh } = useAuth();
  const chariow = account.integrations.chariow;
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const showForm = editing || !chariow.connected;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/api/account/integrations/chariow', { method: 'PUT', body: { apiKey: apiKey.trim() } });
      setApiKey('');
      setEditing(false);
      await refresh();
      toast.success('Clé Chariow vérifiée et enregistrée');
    } catch (caught) {
      setError(toApiError(caught, 'La clé n’a pas pu être enregistrée.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await apiRequest('/api/account/integrations/chariow', { method: 'DELETE' });
      await refresh();
      toast.success('Clé Chariow retirée');
    } catch (caught) {
      toast.error('La clé n’a pas pu être retirée', { description: toApiError(caught, 'Erreur inconnue.').message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="connexions" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <PlugZap className="size-4 text-brand-green-text" aria-hidden="true" />
            Connexions
          </h2>
        </CardTitle>
        <CardDescription>Vos boutiques et services, reliés avec vos propres clés.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">Chariow</h3>
              <p className="text-sm text-muted-foreground">Catalogue, ventes et affiliation de votre boutique.</p>
            </div>
            {chariow.connected ? <Badge variant="success">Connectée</Badge> : <Badge variant="outline">Non connectée</Badge>}
          </div>

          {chariow.source === 'own' && (
            <p className="text-sm text-muted-foreground">
              Votre clé se terminant par <span className="font-mono font-semibold text-foreground">…{chariow.hint}</span>
              {chariow.verifiedAt ? `, vérifiée le ${formatDateFr(chariow.verifiedAt, true)}` : ''}.
            </p>
          )}
          {chariow.source === 'admin' && (
            <p className="text-sm text-muted-foreground">
              Compte administrateur : la boutique de Smart Creator est reliée par la clé du serveur, réservée aux administrateurs.
            </p>
          )}

          {showForm ? (
            <form onSubmit={(event) => void save(event)} className="space-y-3">
              {error && (
                <Alert variant="danger" role="alert">
                  <TriangleAlert />
                  <AlertDescription>{error.message}</AlertDescription>
                </Alert>
              )}
              <Field>
                <FieldLabel htmlFor="chariow-key">Clé API Chariow</FieldLabel>
                <PasswordInput
                  id="chariow-key"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="sk_…"
                />
                <FieldDescription>
                  À créer dans app.chariow.com → Paramètres → Clés API. Elle est vérifiée auprès de Chariow, chiffrée puis stockée : elle
                  ne sera plus jamais affichée, même à vous.
                </FieldDescription>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || apiKey.trim().length < 10}>
                  {busy && <Spinner />}
                  Vérifier et enregistrer
                </Button>
                {chariow.connected && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setEditing(false);
                      setError(null);
                    }}
                  >
                    Annuler
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <KeyRound />
                {chariow.source === 'own' ? 'Remplacer la clé' : 'Utiliser ma propre clé'}
              </Button>
              {chariow.source === 'own' && (
                <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy}>
                  Retirer
                </Button>
              )}
            </div>
          )}
        </div>

        <dl className="divide-y">
          <div className="flex items-start justify-between gap-4 pb-4">
            <dt>
              <span className="block text-sm font-medium">Comptes publicitaires connectés</span>
              <span className="text-sm text-muted-foreground">Connexion par OAuth officiel uniquement, révocable à tout moment.</span>
            </dt>
            <dd className="shrink-0 text-sm text-muted-foreground">Aucun</dd>
          </div>
          <div className="flex items-start justify-between gap-4 pt-4">
            <dt>
              <span className="block text-sm font-medium">Boucle de performance</span>
              <span className="text-sm text-muted-foreground">Partage anonymisé de vos ventes, publié seulement à partir de 5 vendeurs.</span>
            </dt>
            <dd className="shrink-0 text-sm text-muted-foreground">Désactivée</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export function AccountView({ onSelectSavedNiche }: AccountViewProps) {
  const { account } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  if (!account) return null;

  return (
    <div className="space-y-6">
      <PageHeader title="Mon compte" description="Profil, points, sécurité et connexions." />
      <ProfileCard account={account} />
      <div className="grid gap-6 lg:grid-cols-2">
        <CreditsCard account={account} />
        <SavedNichesCard niches={account.savedNiches} onSelect={onSelectSavedNiche} />
      </div>
      <SecurityCard account={account} />
      <ConnectionsCard account={account} />
      <PlansCard currentPlanId={account.plan.id} />
    </div>
  );
}
