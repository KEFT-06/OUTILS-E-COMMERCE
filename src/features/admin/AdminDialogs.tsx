import { COUNTRIES, findCountry } from '@server/shared/countries';
import { formatMoney, fractionDigits } from '@server/shared/currency';
import { CountryCombobox } from '@/shared/components/CountryCombobox';
import type { PlanCatalog } from '@/shared/types/auth';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Banknote, Ban, KeyRound, LogOut, Minus, Plus, RotateCcw, Search, TriangleAlert, UserPlus, Zap } from 'lucide-react';
import type { AdminMeta, AdminPayment, AdminUserDetail, UserList } from '@/features/admin/adminApi';
import { CopyableLink } from '@/features/admin/components';
import { apiRequest } from '@/shared/lib/api';
import { type ApiError, toApiError } from '@/shared/lib/apiError';
import { PAYMENT_METHOD_LABELS, labelOf } from '@/shared/lib/labels';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Fenêtres d'action de l'administration. Chacune exige une raison quand l'action
 * touche au solde, au palier ou à l'accès d'un compte : elle part dans le journal
 * d'audit avec le nom de son auteur.
 */

function ErrorLine({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <Alert variant="danger" role="alert">
      <TriangleAlert />
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}

function useDialogState() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(toApiError(caught, fallback));
    } finally {
      setBusy(false);
    }
  };

  return { open, setOpen, busy, error, setError, run };
}

/* -------------------------------------------------------------------------- */
/*  Crédits                                                                    */
/* -------------------------------------------------------------------------- */

const QUICK_AMOUNTS = [10, 50, 100, 500];

export function GrantCreditsDialog({ detail, onDone }: { detail: AdminUserDetail; onDone: (detail: AdminUserDetail) => void }) {
  const state = useDialogState();
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('50');
  const [note, setNote] = useState('');

  const value = Number.parseInt(amount, 10);
  const valid = Number.isInteger(value) && value > 0 && value <= 100_000 && note.trim().length >= 3;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void state.run(async () => {
      const result = await apiRequest<{ applied: number; balance: number; user: AdminUserDetail }>(
        `/api/admin/users/${detail.user.id}/credits`,
        { method: 'POST', body: { amount: mode === 'add' ? value : -value, note: note.trim() } },
      );
      toast.success(`${result.applied > 0 ? '+' : ''}${result.applied} points`, {
        description: `Nouveau solde de ${detail.user.name} : ${result.balance} points.`,
      });
      onDone(result.user);
      state.setOpen(false);
      setNote('');
    }, 'La recharge a échoué.');
  };

  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Zap />
          Recharger des points
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Points de {detail.user.name}</DialogTitle>
            <DialogDescription>
              Solde actuel : {detail.credits.unlimited ? 'illimité' : `${detail.credits.total} points`} (dont {detail.credits.bonus}{' '}
              bonus). Les points ajoutés sont des points bonus : ils n’expirent pas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Sens du mouvement">
            <Button type="button" variant={mode === 'add' ? 'default' : 'outline'} aria-pressed={mode === 'add'} onClick={() => setMode('add')}>
              <Plus />
              Ajouter
            </Button>
            <Button type="button" variant={mode === 'remove' ? 'destructive' : 'outline'} aria-pressed={mode === 'remove'} onClick={() => setMode('remove')}>
              <Minus />
              Retirer
            </Button>
          </div>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="credits-amount">Nombre de points</FieldLabel>
              <Input
                id="credits-amount"
                type="number"
                min={1}
                max={100000}
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <div className="flex flex-wrap gap-1.5">
                {QUICK_AMOUNTS.map((quick) => (
                  <Button key={quick} type="button" variant="outline" size="sm" className="h-7" onClick={() => setAmount(String(quick))}>
                    {quick}
                  </Button>
                ))}
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="credits-note">Raison</FieldLabel>
              <Input
                id="credits-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={300}
                placeholder="ex. geste commercial après un incident"
              />
              <FieldDescription>Inscrite au registre des points de l’utilisateur et au journal d’audit.</FieldDescription>
            </Field>
          </FieldGroup>

          <ErrorLine error={state.error} />

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => state.setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" variant={mode === 'remove' ? 'destructive' : 'default'} disabled={!valid || state.busy}>
              {state.busy && <Spinner />}
              {mode === 'add' ? `Ajouter ${Number.isInteger(value) && value > 0 ? value : ''} points` : `Retirer ${Number.isInteger(value) && value > 0 ? value : ''} points`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RefillPlanCreditsDialog({ detail, onDone }: { detail: AdminUserDetail; onDone: (detail: AdminUserDetail) => void }) {
  const state = useDialogState();
  const [note, setNote] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void state.run(async () => {
      const result = await apiRequest<AdminUserDetail>(`/api/admin/users/${detail.user.id}/credits/refill`, {
        method: 'POST',
        body: { note: note.trim() },
      });
      toast.success('Quota mensuel rechargé');
      onDone(result);
      state.setOpen(false);
      setNote('');
    }, 'Le quota n’a pas pu être rechargé.');
  };

  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={detail.credits.unlimited}>
          <RotateCcw />
          Recharger le quota
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Recharger le quota du mois</DialogTitle>
            <DialogDescription>
              Les points du palier {detail.user.plan.label} reviennent à {detail.credits.allowance ?? 0} et un nouveau cycle d’un mois
              commence. Les points bonus ne changent pas.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="refill-note">Raison</FieldLabel>
            <Input id="refill-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
          </Field>
          <ErrorLine error={state.error} />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => state.setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={note.trim().length < 3 || state.busy}>
              {state.busy && <Spinner />}
              Recharger
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Palier                                                                     */
/* -------------------------------------------------------------------------- */

const DURATIONS = [
  { value: '1', label: '1 mois' },
  { value: '3', label: '3 mois' },
  { value: '6', label: '6 mois' },
  { value: '12', label: '12 mois' },
  { value: 'none', label: 'Sans échéance' },
];

export function ChangePlanDialog({
  detail,
  plans,
  onDone,
}: {
  detail: AdminUserDetail;
  plans: AdminMeta['plans'];
  onDone: (detail: AdminUserDetail) => void;
}) {
  const state = useDialogState();
  const [plan, setPlan] = useState<string>(detail.user.plan.id);
  const [duration, setDuration] = useState('1');
  const [refill, setRefill] = useState(true);
  const [note, setNote] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void state.run(async () => {
      const result = await apiRequest<AdminUserDetail>(`/api/admin/users/${detail.user.id}/plan`, {
        method: 'PATCH',
        body: {
          plan,
          durationMonths: duration === 'none' || plan === 'free' ? null : Number(duration),
          refillCredits: refill,
          note: note.trim(),
        },
      });
      toast.success(`Palier ${result.user.plan.label} appliqué`);
      onDone(result);
      state.setOpen(false);
      setNote('');
    }, 'Le palier n’a pas pu être changé.');
  };

  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Changer le palier
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Palier de {detail.user.name}</DialogTitle>
            <DialogDescription>
              Sans paiement enregistré, ce changement n’apparaît pas dans les revenus. Pour un abonnement payé, utilisez « Enregistrer
              un paiement ».
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="plan-select">Palier</FieldLabel>
                <Select value={plan} onValueChange={setPlan}>
                  <SelectTrigger id="plan-select" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="plan-duration">Durée</FieldLabel>
                <Select value={plan === 'free' ? 'none' : duration} onValueChange={setDuration} disabled={plan === 'free'}>
                  <SelectTrigger id="plan-duration" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex items-start gap-2.5">
              <Checkbox id="plan-refill" checked={refill} onCheckedChange={(checked) => setRefill(checked === true)} className="mt-0.5" />
              <Label htmlFor="plan-refill" className="text-sm leading-relaxed font-normal">
                Recharger le quota du nouveau palier et ouvrir un cycle d’un mois
              </Label>
            </div>
            <Field>
              <FieldLabel htmlFor="plan-note">Raison</FieldLabel>
              <Input id="plan-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="ex. essai offert" />
            </Field>
          </FieldGroup>

          <ErrorLine error={state.error} />

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => state.setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={note.trim().length < 3 || state.busy}>
              {state.busy && <Spinner />}
              Appliquer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Paiements                                                                  */
/* -------------------------------------------------------------------------- */

const todayIso = () => new Date().toISOString().slice(0, 10);

const MAIN_CURRENCIES = ['XAF', 'XOF', 'EUR', 'USD'];
const PAYMENT_CURRENCIES = [
  ...MAIN_CURRENCIES,
  ...[...new Set(COUNTRIES.map((country) => country.currency))].filter((code) => !MAIN_CURRENCIES.includes(code)).sort(),
];

export function RecordPaymentDialog({
  plans,
  presetUser,
  presetPlan,
  onDone,
}: {
  plans: AdminMeta['plans'];
  presetUser?: { id: string; name: string; email: string; country?: string | null };
  /** Palier actuel du compte : proposé par défaut, un renouvellement étant le cas le plus courant. */
  presetPlan?: string;
  onDone?: () => void;
}) {
  const state = useDialogState();
  const paidPlans = plans.filter((plan) => plan.id !== 'free');
  const [user, setUser] = useState(presetUser ?? null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<UserList['users']>([]);
  const [plan, setPlan] = useState<string>(
    presetPlan && presetPlan !== 'free' ? presetPlan : (paidPlans[0]?.id ?? 'plus'),
  );
  const [months, setMonths] = useState('1');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(() => findCountry(presetUser?.country)?.currency ?? 'XAF');
  const [method, setMethod] = useState('mobile_money');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [activate, setActivate] = useState(true);

  // Montant proposé d'après le prix du palier dans la devise choisie, quand il est fixé.
  useEffect(() => {
    if (!state.open) return;
    let cancelled = false;
    apiRequest<PlanCatalog>(`/api/plans?currency=${encodeURIComponent(currency)}`)
      .then((catalog) => {
        const price = catalog.plans.find((candidate) => candidate.id === plan)?.price;
        if (!cancelled && price && price.currency === currency && price.monthly > 0) {
          setAmount(String(Math.round(price.monthly * Number(months) * 100) / 100));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [plan, months, currency, state.open]);

  useEffect(() => {
    if (presetUser || !state.open || search.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiRequest<UserList>(`/api/admin/users?search=${encodeURIComponent(search.trim())}&pageSize=5`, { signal: controller.signal })
        .then((list) => setResults(list.users))
        .catch(() => undefined);
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, presetUser, state.open]);

  const value = Number.parseFloat(amount.replace(',', '.'));
  const valid = Boolean(user) && Number.isFinite(value) && value > 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    void state.run(async () => {
      await apiRequest<{ payment: AdminPayment }>('/api/admin/payments', {
        method: 'POST',
        body: {
          userId: user.id,
          plan,
          periodMonths: Number(months),
          amount: value,
          currency,
          method,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(paidOn !== todayIso() ? { paidAt: `${paidOn}T12:00:00.000Z` } : {}),
          activatePlan: activate,
        },
      });
      toast.success(`Paiement de ${formatMoney(value, currency)} enregistré`, {
        description: activate ? `Palier activé pour ${user.name}.` : undefined,
      });
      onDone?.();
      state.setOpen(false);
      setReference('');
      setNote('');
      if (!presetUser) setUser(null);
    }, 'Le paiement n’a pas pu être enregistré.');
  };

  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={presetUser ? 'outline' : 'default'}>
          <Banknote />
          Enregistrer un paiement
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Enregistrer un paiement</DialogTitle>
            <DialogDescription>
              Pour un abonnement réglé par Mobile Money, virement ou espèces. Le montant alimente les revenus ; le palier est activé
              pour la durée payée, ajoutée à la période en cours s’il s’agit d’un renouvellement.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            {presetUser ? (
              <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">{presetUser.name}</span> · {presetUser.email}
              </p>
            ) : user ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{user.name}</span> · {user.email}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setUser(null)}>
                  Changer
                </Button>
              </div>
            ) : (
              <Field>
                <FieldLabel htmlFor="payment-user">Compte</FieldLabel>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="payment-user"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Nom ou adresse e-mail"
                    className="pl-9"
                    autoComplete="off"
                  />
                </div>
                {results.length > 0 && (
                  <ul className="divide-y rounded-lg border">
                    {results.map((candidate) => (
                      <li key={candidate.id}>
                        <button
                          type="button"
                          className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent"
                          onClick={() => {
                            setUser({ id: candidate.id, name: candidate.name, email: candidate.email });
                            const local = findCountry(candidate.country)?.currency;
                            if (local) setCurrency(local);
                            setSearch('');
                          }}
                        >
                          <span className="font-medium">{candidate.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {candidate.email} · palier {candidate.plan.label}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="payment-plan">Palier payé</FieldLabel>
                <Select value={plan} onValueChange={setPlan}>
                  <SelectTrigger id="payment-plan" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paidPlans.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="payment-months">Durée</FieldLabel>
                <Select value={months} onValueChange={setMonths}>
                  <SelectTrigger id="payment-months" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATIONS.filter((option) => option.value !== 'none').map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="payment-amount">Montant payé</FieldLabel>
                <Input
                  id="payment-amount"
                  type="number"
                  min={0}
                  step={fractionDigits(currency) === 0 ? 1 : 0.01}
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder={fractionDigits(currency) === 0 ? 'ex. 9900' : 'ex. 14.99'}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="payment-currency">Devise</FieldLabel>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="payment-currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_CURRENCIES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currency !== 'XAF' && currency !== 'XOF' && <FieldDescription>Converti en francs CFA au taux du jour pour les revenus.</FieldDescription>}
              </Field>
              <Field>
                <FieldLabel htmlFor="payment-method">Moyen de paiement</FieldLabel>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger id="payment-method" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(PAYMENT_METHOD_LABELS).map((candidate) => (
                      <SelectItem key={candidate} value={candidate}>
                        {labelOf(PAYMENT_METHOD_LABELS, candidate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="payment-reference">Référence</FieldLabel>
                <Input
                  id="payment-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  maxLength={120}
                  placeholder="n° de transaction"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="payment-date">Date du paiement</FieldLabel>
                <Input id="payment-date" type="date" max={todayIso()} value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="payment-note">Note</FieldLabel>
              <Textarea id="payment-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={300} />
            </Field>
            <div className="flex items-start gap-2.5">
              <Checkbox id="payment-activate" checked={activate} onCheckedChange={(checked) => setActivate(checked === true)} className="mt-0.5" />
              <Label htmlFor="payment-activate" className="text-sm leading-relaxed font-normal">
                Activer le palier payé et recharger son quota
              </Label>
            </div>
          </FieldGroup>

          <ErrorLine error={state.error} />

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => state.setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={!valid || state.busy}>
              {state.busy && <Spinner />}
              Enregistrer {Number.isFinite(value) && value > 0 ? formatMoney(value, currency) : ''}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RefundPaymentDialog({ payment, onDone }: { payment: AdminPayment; onDone: () => void }) {
  const state = useDialogState();
  const [note, setNote] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void state.run(async () => {
      await apiRequest(`/api/admin/payments/${payment.id}/refund`, { method: 'POST', body: { note: note.trim() } });
      toast.success('Paiement marqué remboursé');
      onDone();
      state.setOpen(false);
    }, 'Le remboursement n’a pas pu être enregistré.');
  };

  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={payment.status !== 'paid'}>
          Rembourser
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rembourser {formatMoney(payment.amount, payment.currency)}</DialogTitle>
            <DialogDescription>
              Le montant sort des revenus. Le palier du compte ne change pas : ajustez-le ensuite depuis sa fiche si nécessaire.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="refund-note">Raison</FieldLabel>
            <Input id="refund-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
          </Field>
          <ErrorLine error={state.error} />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => state.setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="destructive" disabled={note.trim().length < 3 || state.busy}>
              {state.busy && <Spinner />}
              Rembourser
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Comptes                                                                    */
/* -------------------------------------------------------------------------- */

export function CreateUserDialog({ plans, onCreated }: { plans: AdminMeta['plans']; onCreated: () => void }) {
  const state = useDialogState();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState('free');
  const [country, setCountry] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);

  const change = (next: boolean) => {
    state.setOpen(next);
    if (!next) {
      setLink(null);
      setName('');
      setEmail('');
      setPlan('free');
      setCountry(null);
      state.setError(null);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void state.run(async () => {
      const result = await apiRequest<{ setupLink: { url: string; expiresAt: string } }>('/api/admin/users', {
        method: 'POST',
        body: { name: name.trim(), email: email.trim(), plan, ...(country ? { country } : {}) },
      });
      setLink(result.setupLink);
      onCreated();
    }, 'Le compte n’a pas pu être créé.');
  };

  return (
    <Dialog open={state.open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus />
          Créer un compte
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {link ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Compte créé</DialogTitle>
              <DialogDescription>
                {name} choisira son mot de passe avec ce lien. Aucun mot de passe ne vous est communiqué, ni à personne d’autre.
              </DialogDescription>
            </DialogHeader>
            <CopyableLink url={link.url} expiresAt={link.expiresAt} />
            <DialogFooter>
              <Button type="button" onClick={() => change(false)}>
                Terminer
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Créer un compte</DialogTitle>
              <DialogDescription>
                Pour un client ou un membre de l’équipe. Vous obtenez un lien à lui transmettre pour qu’il choisisse son mot de passe.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="new-user-name">Nom</FieldLabel>
                <Input id="new-user-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-user-email">Adresse e-mail</FieldLabel>
                <Input id="new-user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-user-country">Pays</FieldLabel>
                <CountryCombobox id="new-user-country" value={country} onChange={setCountry} showCurrency />
                <FieldDescription>Facultatif : la personne pourra le choisir elle-même.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="new-user-plan">Palier</FieldLabel>
                <Select value={plan} onValueChange={setPlan}>
                  <SelectTrigger id="new-user-plan" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Un palier payant attribué ici n’entre pas dans les revenus : enregistrez le paiement à part.</FieldDescription>
              </Field>
            </FieldGroup>
            <ErrorLine error={state.error} />
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => change(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={name.trim().length < 2 || !email.includes('@') || state.busy}>
                {state.busy && <Spinner />}
                Créer le compte
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PasswordLinkDialog({ detail }: { detail: AdminUserDetail }) {
  const state = useDialogState();
  const [link, setLink] = useState<{ url: string; expiresAt: string; purpose: 'setup' | 'reset' } | null>(null);

  const change = (next: boolean) => {
    state.setOpen(next);
    if (!next) {
      setLink(null);
      state.setError(null);
    }
  };

  const create = () =>
    void state.run(async () => {
      setLink(await apiRequest(`/api/admin/users/${detail.user.id}/password-link`, { method: 'POST' }));
    }, 'Le lien n’a pas pu être créé.');

  return (
    <Dialog open={state.open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound />
          Lien de mot de passe
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{detail.user.passwordSet ? 'Réinitialiser le mot de passe' : 'Lien de création du mot de passe'}</DialogTitle>
          <DialogDescription>
            Le lien permet à {detail.user.name} de choisir un nouveau mot de passe ; toutes ses sessions sont alors fermées. Tout lien
            précédent devient inutilisable.
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <CopyableLink url={link.url} expiresAt={link.expiresAt} />
        ) : (
          <Button type="button" onClick={create} disabled={state.busy}>
            {state.busy && <Spinner />}
            Créer le lien
          </Button>
        )}
        <ErrorLine error={state.error} />
      </DialogContent>
    </Dialog>
  );
}

export function RevokeSessionsDialog({ detail, onDone }: { detail: AdminUserDetail; onDone: () => void }) {
  const state = useDialogState();
  const count = detail.sessions.length;

  const confirm = () =>
    void state.run(async () => {
      const result = await apiRequest<{ revoked: number }>(`/api/admin/users/${detail.user.id}/sessions/revoke`, { method: 'POST' });
      toast.success(`${result.revoked} session(s) fermée(s)`);
      onDone();
      state.setOpen(false);
    }, 'Les sessions n’ont pas pu être fermées.');

  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={count === 0}>
          <LogOut />
          Déconnecter partout
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Déconnecter {detail.user.name} ?</DialogTitle>
          <DialogDescription>
            {count} session{count > 1 ? 's' : ''} ouverte{count > 1 ? 's' : ''} ser{count > 1 ? 'ont' : 'a'} fermée
            {count > 1 ? 's' : ''} immédiatement. La personne pourra se reconnecter avec son mot de passe.
          </DialogDescription>
        </DialogHeader>
        <ErrorLine error={state.error} />
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => state.setOpen(false)}>
            Annuler
          </Button>
          <Button type="button" variant="destructive" onClick={confirm} disabled={state.busy}>
            {state.busy && <Spinner />}
            Déconnecter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SuspendDialog({ detail, onDone }: { detail: AdminUserDetail; onDone: (detail: AdminUserDetail) => void }) {
  const state = useDialogState();
  const [reason, setReason] = useState('');
  const suspended = detail.user.status === 'suspended';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void state.run(async () => {
      const result = await apiRequest<AdminUserDetail>(`/api/admin/users/${detail.user.id}/status`, {
        method: 'POST',
        body: suspended ? { status: 'active' } : { status: 'suspended', reason: reason.trim() },
      });
      toast.success(suspended ? 'Compte débloqué' : 'Compte bloqué');
      onDone(result);
      state.setOpen(false);
      setReason('');
    }, 'Le statut n’a pas pu être modifié.');
  };

  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogTrigger asChild>
        <Button variant={suspended ? 'outline' : 'ghost'} size="sm" className={cn(!suspended && 'text-danger hover:text-danger')}>
          <Ban />
          {suspended ? 'Débloquer' : 'Bloquer'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{suspended ? `Débloquer ${detail.user.name}` : `Bloquer ${detail.user.name}`}</DialogTitle>
            <DialogDescription>
              {suspended
                ? 'La personne pourra de nouveau se connecter. Ses données, son solde et son palier sont intacts.'
                : 'La personne est déconnectée immédiatement, sur tous ses appareils, et toute connexion est refusée. Rien n’est supprimé : vous pourrez débloquer le compte.'}
            </DialogDescription>
          </DialogHeader>
          {!suspended && (
            <Field>
              <FieldLabel htmlFor="suspend-reason">Raison</FieldLabel>
              <Textarea id="suspend-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={300} />
            </Field>
          )}
          <ErrorLine error={state.error} />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => state.setOpen(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              variant={suspended ? 'default' : 'destructive'}
              disabled={state.busy || (!suspended && reason.trim().length < 3)}
            >
              {state.busy && <Spinner />}
              {suspended ? 'Débloquer' : 'Bloquer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
