import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowRight, Bookmark, Check, Database, Download, History, KeyRound, LogOut, MonitorSmartphone, Pencil, PlugZap, ShieldCheck, Trash2, TriangleAlert, X, Zap } from 'lucide-react';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { initialsOf, useAuth } from '@/features/auth/AuthContext';
import { PASSWORD_MIN_LENGTH, PasswordHints, PasswordInput } from '@/features/auth/PasswordInput';
import { SecondFactorChooser, SecurityCodeForm } from '@/features/auth/SecurityCodeForm';
import { RecoveryCodesPanel, TwoFactorSetup } from '@/features/auth/TwoFactorSetup';
import { CountryCombobox } from '@/shared/components/CountryCombobox';
import { PlanCards } from '@/shared/components/PlanCards';
import { findCountry } from '@server/shared/countries';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiRequest, passwordProblemsOf } from '@/shared/lib/api';
import { type ApiError, readApiError, toApiError } from '@/shared/lib/apiError';
import { triggerDownload } from '@/shared/lib/download';
import { formatDateFr, formatRelativeFr } from '@/shared/lib/formatDate';
import { CREDIT_REASON_LABELS, labelOf } from '@/shared/lib/labels';
import { usePlans } from '@/shared/lib/plans';
import { cn } from '@/shared/lib/utils';
import type { Account } from '@/shared/types/auth';
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

function CountryField({ account }: { account: Account }) {
  const { updateProfile } = useAuth();
  const [saving, setSaving] = useState(false);

  const change = async (code: string) => {
    if (code === account.country) return;
    setSaving(true);
    try {
      await updateProfile({ country: code });
      const country = findCountry(code);
      toast.success('Pays enregistré', {
        description: country ? `Les prix s’affichent désormais en ${country.currency}.` : undefined,
      });
    } catch (caught) {
      toast.error('Le pays n’a pas pu être enregistré', { description: toApiError(caught, 'Erreur inconnue.').message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="profile-country" className="text-sm text-muted-foreground">
        Pays
      </label>
      <CountryCombobox
        id="profile-country"
        value={account.country}
        onChange={(code) => void change(code)}
        showCurrency
        disabled={saving}
        placeholder="Choisissez votre pays"
        className="h-8 w-auto min-w-52"
      />
      <span className="text-xs text-muted-foreground">Prix affichés en {account.currency}</span>
    </div>
  );
}

/** Adresse pas encore confirmée : proposé seulement quand l'envoi d'e-mails est configuré. */
function EmailVerificationNotice({ account }: { account: Account }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  if (account.emailVerification.verified || !account.emailVerification.available) return null;

  const send = async () => {
    setState('sending');
    try {
      await apiRequest('/api/account/verify-email/send', { method: 'POST' });
      setState('sent');
    } catch (caught) {
      setState('idle');
      toast.error('L’e-mail n’a pas pu partir', { description: toApiError(caught, 'Réessayez dans un moment.').message });
    }
  };

  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant="warning">Adresse non confirmée</Badge>
      {state === 'sent' ? (
        <span className="text-muted-foreground">E-mail envoyé : ouvrez le lien qu’il contient.</span>
      ) : (
        <Button variant="link" className="h-auto p-0" onClick={() => void send()} disabled={state === 'sending'}>
          {state === 'sending' && <Spinner />}
          Recevoir l’e-mail de confirmation
        </Button>
      )}
    </p>
  );
}

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
          <EmailVerificationNotice account={account} />
          <CountryField account={account} />

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={account.plan.id === 'free' ? 'secondary' : 'brand'}>Palier {account.plan.label}</Badge>
            {account.role === 'admin' ? (
              <Badge variant="info">Administrateur</Badge>
            ) : account.isStaff ? (
              <Badge variant="outline">Équipe</Badge>
            ) : null}
            {account.twoFactor.enabled && <Badge variant="success">Second facteur actif</Badge>}
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

function SavedNichesCard({ account, onSelect }: { account: Account; onSelect: (niche: string) => void }) {
  const { removeNiche } = useAuth();
  const niches = account.savedNiches;
  const limit = account.limits.savedNiches;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <Bookmark className="size-4 text-brand-green-text" aria-hidden="true" />
            Niches enregistrées
          </h2>
        </CardTitle>
        <CardDescription>
          {limit === null
            ? `${niches.length} enregistrée${niches.length > 1 ? 's' : ''}, sans limite avec votre palier.`
            : `${niches.length} sur ${limit} avec votre palier ${account.plan.label}.`}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/app/niches">
              Catalogue
              <ArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {limit !== null && <Progress value={limit === 0 ? 100 : Math.min(100, (niches.length / limit) * 100)} aria-label="Niches enregistrées" />}
        {niches.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>Aucune niche enregistrée</EmptyTitle>
              <EmptyDescription>Enregistrez des niches depuis le catalogue pour les retrouver ici.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="space-y-2">
            {niches.map((niche) => (
              <li key={niche} className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="h-auto flex-1 justify-between py-3 text-left font-medium whitespace-normal"
                  onClick={() => onSelect(niche)}
                >
                  {niche}
                  <ArrowRight />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Retirer ${niche}`}
                  onClick={() => {
                    void removeNiche(niche).catch((caught: unknown) =>
                      toast.error('La niche n’a pas pu être retirée', { description: toApiError(caught, 'Erreur inconnue.').message }),
                    );
                  }}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PlansCard({ account }: { account: Account }) {
  const { catalog, error } = usePlans(account.country);

  return (
    <Card id="paliers" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>
          <h2>Paliers d’abonnement</h2>
        </CardTitle>
        <CardDescription>
          Prix en {catalog?.currency ?? account.currency}, selon votre pays. Chaque forfait fixe vos points, vos niches
          enregistrées et vos méthodes publicitaires.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="danger">
            <TriangleAlert />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : (
          <PlanCards
            catalog={catalog}
            currentPlanId={account.plan.id}
            renderAction={(plan, isCurrent) =>
              isCurrent ? (
                <Button variant="outline" className="w-full" disabled>
                  <Check />
                  Palier actuel
                </Button>
              ) : plan.price?.monthly === 0 ? null : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Paiement en ligne bientôt disponible. En attendant, l’administrateur active ce palier après votre paiement.
                </p>
              )
            }
          />
        )}
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
      <FieldLabel htmlFor={id}>Code de votre application ou code de sécurité</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, 128))}
        type="password"
        autoComplete="off"
        className="h-11"
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
            <Button type="submit" disabled={busy || code.trim().length < 6}>
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
      toast.success('Application d’authentification retirée');
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
            <DialogTitle>Retirer l’application d’authentification ?</DialogTitle>
            <DialogDescription>Votre code de sécurité, s’il est défini, restera demandé à la connexion. Sinon, votre mot de passe suffira : votre compte sera moins protégé.</DialogDescription>
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
            <Button type="submit" variant="destructive" disabled={busy || !password || code.trim().length < 6}>
              {busy && <Spinner />}
              Désactiver
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SecurityCodeDialog({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const defined = account.twoFactor.methods.code;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {defined ? 'Modifier' : 'Définir'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{defined ? 'Modifier le code de sécurité' : 'Définir un code de sécurité'}</DialogTitle>
          <DialogDescription>Demandé après votre mot de passe, à chaque connexion. Vos autres appareils seront déconnectés.</DialogDescription>
        </DialogHeader>
        <SecurityCodeForm account={account} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RemoveSecurityCodeDialog() {
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
      const result = await apiRequest<{ account: Account }>('/api/account/two-factor/security-code/remove', {
        method: 'POST',
        body: { password, code },
      });
      setAccount(result.account);
      toast.success('Code de sécurité retiré');
      change(false);
    } catch (caught) {
      setError(toApiError(caught, 'Le code n’a pas pu être retiré.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-danger hover:text-danger">
          Retirer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Retirer le code de sécurité ?</DialogTitle>
            <DialogDescription>Il ne sera plus demandé à la connexion.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <input type="text" name="username" autoComplete="username" hidden readOnly />
            <Field>
              <FieldLabel htmlFor="remove-code-password">Mot de passe</FieldLabel>
              <PasswordInput id="remove-code-password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            </Field>
            <CodeField id="remove-code" value={code} onChange={setCode} />
          </FieldGroup>
          {error && (
            <Alert variant="danger" role="alert">
              <TriangleAlert />
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => change(false)}>
              Garder le code
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !password || code.trim().length < 6}>
              {busy && <Spinner />}
              Retirer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddAuthenticatorDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Configurer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Application d’authentification</DialogTitle>
          <DialogDescription>Google Authenticator, Microsoft Authenticator ou 2FAS : un code à 6 chiffres en plus du mot de passe.</DialogDescription>
        </DialogHeader>
        <TwoFactorSetup onEnabled={() => setOpen(false)} />
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
  const methods = account.twoFactor.methods;
  return (
    <Card id="securite" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-brand-green-text" aria-hidden="true" />
            Sécurité
          </h2>
        </CardTitle>
        <CardDescription>Mot de passe, second facteur et appareils connectés.</CardDescription>
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
              Second facteur
            </h3>
            {account.twoFactor.enabled ? <Badge variant="success">Actif</Badge> : <Badge variant="outline">Désactivé</Badge>}
          </div>
          {account.twoFactor.enabled ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Après votre mot de passe, Smart Creator demande{' '}
                {methods.code && methods.app
                  ? 'votre code de sécurité ou le code de votre application'
                  : methods.code
                    ? 'votre code de sécurité'
                    : 'le code de votre application'}{' '}
                à chaque connexion.
              </p>
              <ul className="divide-y rounded-lg border">
                <li className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <KeyRound className="size-4 text-brand-green-text" aria-hidden="true" />
                    Code de sécurité
                    {methods.code ? <Badge variant="success">Actif</Badge> : <Badge variant="outline">Non défini</Badge>}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <SecurityCodeDialog account={account} />
                    {methods.code && (!account.isStaff || methods.app) && <RemoveSecurityCodeDialog />}
                  </div>
                </li>
                <li className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <MonitorSmartphone className="size-4 text-brand-green-text" aria-hidden="true" />
                    Application d’authentification
                    {methods.app ? <Badge variant="success">Active</Badge> : <Badge variant="outline">Non configurée</Badge>}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {methods.app ? (
                      <>
                        <RegenerateRecoveryCodesDialog />
                        {(!account.isStaff || methods.code) && <DisableTwoFactorDialog />}
                      </>
                    ) : (
                      <AddAuthenticatorDialog />
                    )}
                  </div>
                </li>
              </ul>
              {account.isStaff && (
                <p className="text-xs text-muted-foreground">
                  Obligatoire pour les comptes qui détiennent des privilèges d’administration : gardez au moins l’un des deux.
                </p>
              )}
            </div>
          ) : (
            <>
              {account.twoFactor.required && (
                <Alert variant="warning">
                  <TriangleAlert />
                  <AlertTitle>Obligatoire pour votre compte</AlertTitle>
                  <AlertDescription>Votre compte détient des privilèges d’administration : activez-en un pour y accéder.</AlertDescription>
                </Alert>
              )}
              <SecondFactorChooser account={account} />
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
/*  Données personnelles                                                       */
/* -------------------------------------------------------------------------- */

const DELETION_WORD = 'SUPPRIMER';

function DeleteAccountDialog({ account }: { account: Account }) {
  const { setAccount } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const needsCode = account.twoFactor.enabled;
  const ready = password.length > 0 && (!needsCode || code.trim().length >= 6) && confirmation.trim() === DELETION_WORD;

  const change = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setPassword('');
      setCode('');
      setConfirmation('');
      setError(null);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/api/account', {
        method: 'DELETE',
        body: { password, confirmation: confirmation.trim(), ...(needsCode ? { code: code.trim() } : {}) },
      });
      navigate('/', { replace: true });
      setAccount(null);
      toast.success('Compte supprimé', { description: 'Vos données ont été effacées. Merci d’avoir utilisé Smart Creator.' });
    } catch (caught) {
      setError(toApiError(caught, 'Le compte n’a pas pu être supprimé.'));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button variant="destructive" className="shrink-0">
          <Trash2 />
          Supprimer mon compte
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Supprimer définitivement votre compte</DialogTitle>
            <DialogDescription>
              Vos analyses, guides, couvertures, points et historiques sont effacés tout de suite, sans retour possible.
              Téléchargez d’abord vos données si vous voulez en garder une copie.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {error && (
              <Alert variant="danger" role="alert">
                <TriangleAlert />
                <AlertTitle>{error.message}</AlertTitle>
              </Alert>
            )}
            <input type="text" name="username" autoComplete="username" value={account.email} hidden readOnly />
            <Field>
              <FieldLabel htmlFor="delete-password">Mot de passe</FieldLabel>
              <PasswordInput
                id="delete-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </Field>
            {needsCode && <CodeField id="delete-code" value={code} onChange={setCode} />}
            <Field>
              <FieldLabel htmlFor="delete-confirmation">Saisissez {DELETION_WORD} pour confirmer</FieldLabel>
              <Input
                id="delete-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </Field>
          </FieldGroup>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => change(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="destructive" disabled={!ready || busy}>
              {busy && <Spinner />}
              Supprimer définitivement
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PersonalDataCard({ account }: { account: Account }) {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const response = await fetch('/api/account/data-export', { credentials: 'same-origin' });
      if (!response.ok) throw await readApiError(response, 'Vos données n’ont pas pu être préparées.');
      triggerDownload(await response.blob(), `smart-creator-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`);
      toast.success('Copie de vos données téléchargée');
    } catch (caught) {
      toast.error('Téléchargement impossible', { description: toApiError(caught, 'Réessayez dans un moment.').message });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card id="donnees" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <Database className="size-4 text-brand-green-text" aria-hidden="true" />
            Vos données
          </h2>
        </CardTitle>
        <CardDescription>Une copie de tout ce que Smart Creator conserve sur vous, ou la suppression de votre compte.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-medium">Télécharger mes données</p>
            <p className="text-sm text-muted-foreground">
              Profil, connexions, points, contenus et paiements, dans un fichier JSON. Mot de passe, codes et clés API n’y
              figurent pas.
            </p>
          </div>
          <Button variant="outline" className="shrink-0" onClick={() => void download()} disabled={downloading}>
            {downloading ? <Spinner /> : <Download />}
            Télécharger
          </Button>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-danger-border bg-danger-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-medium text-danger">Supprimer mon compte</p>
            <p className="text-sm text-foreground/85">
              Suppression immédiate et définitive. Seuls vos paiements restent enregistrés, avec votre adresse e-mail, pour
              la comptabilité.
            </p>
          </div>
          <DeleteAccountDialog account={account} />
        </div>
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
      <PageHeader title="Mon compte" description="Profil et pays, points, niches, sécurité, connexions, paliers et données personnelles." />
      {!account.country && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Choisissez votre pays</AlertTitle>
          <AlertDescription>Il fixe la devise de vos prix : sans pays, ils s’affichent en dollars.</AlertDescription>
        </Alert>
      )}
      <ProfileCard account={account} />
      <div className="grid gap-6 lg:grid-cols-2">
        <CreditsCard account={account} />
        <SavedNichesCard account={account} onSelect={onSelectSavedNiche} />
      </div>
      <SecurityCard account={account} />
      <ConnectionsCard account={account} />
      <PlansCard account={account} />
      <PersonalDataCard account={account} />
    </div>
  );
}
