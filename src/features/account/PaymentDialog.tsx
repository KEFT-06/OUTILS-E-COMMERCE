import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, ChevronRight, CreditCard, ExternalLink, Lock, Smartphone, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthContext';
import {
  type MobileCheckoutStart,
  type MobileOperator,
  type PaymentMethods,
  type PaymentPeriod,
  billingApi,
  operatorTone,
  readablePhone,
} from '@/features/account/paymentMethods';
import { toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { cn } from '@/shared/lib/utils';
import type { PlanDefinition } from '@/shared/types/auth';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Paiement d'un palier : le choix du moyen, puis le paiement lui-même.
 *
 * Demande du propriétaire, 11/10/2026 : brancher le Mobile Money, et montrer le choix du service
 * de paiement. L'écran ne propose que ce qui peut réellement encaisser pour ce compte — s'il n'y
 * a qu'un moyen, on y va directement.
 *
 * Mobile Money : l'opérateur, le numéro, puis la validation se fait sur le téléphone, avec le
 * code secret du client. L'écran suit la demande ; s'il est fermé avant, le palier s'active quand
 * même dès que le paiement est validé (le serveur le relit de son côté).
 */

/** Rythme de relecture pendant que le client valide sur son téléphone. */
const POLL_MS = 4_000;
/** Au-delà, l'écran cesse d'attendre ; le serveur, lui, continue. */
const WAIT_MS = 3 * 60_000;

type Step = 'chargement' | 'choix' | 'mobile' | 'attente' | 'plus-tard' | 'reussi' | 'refuse' | 'ferme';

const PERIOD_LABEL: Record<PaymentPeriod, string> = { month: '1 mois', year: '12 mois' };

function OperatorMark({ operator, className }: { operator: Pick<MobileOperator, 'slug' | 'name'>; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold tracking-wide', operatorTone(operator.slug), className)}>{operator.name}</span>;
}

function MethodTile({ icon, title, description, marks, onClick, disabled }: { icon: React.ReactNode; title: string; description: string; marks: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-green/15 text-brand-green-text">{icon}</span>
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
        <span className="flex flex-wrap gap-1.5">{marks}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </button>
  );
}

export function PaymentDialog({ plan, period, onClose }: { plan: PlanDefinition; period: PaymentPeriod; onClose: () => void }) {
  const { refresh, account } = useAuth();
  const [step, setStep] = useState<Step>('chargement');
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  // Le numéro du compte est proposé d'emblée : celui qui paie avec un autre numéro le remplace.
  const [phone, setPhone] = useState(() => account?.phone ?? '');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<MobileCheckoutStart | null>(null);
  const [activeUntil, setActiveUntil] = useState<string | null>(null);
  const closed = useRef(false);

  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  const payByCard = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await billingApi.card(plan.id, period);
      if (new URL(url).protocol !== 'https:') throw new Error('Adresse de paiement invalide.');
      window.location.assign(url);
    } catch (caught) {
      if (closed.current) return;
      setError(toApiError(caught, 'Le paiement n’a pas pu démarrer : aucun montant n’a été débité.').message);
      setBusy(false);
    }
  };

  // À l'ouverture : ce qui peut encaisser pour ce compte, et le montant en Mobile Money.
  useEffect(() => {
    let cancelled = false;
    billingApi
      .methods({ plan: plan.id, period })
      .then((found) => {
        if (cancelled) return;
        setMethods(found);
        if (found.mobile.available) setOperator(found.mobile.operators[0]?.slug ?? null);
        if (found.card.available && found.mobile.available) setStep('choix');
        else if (found.mobile.available) setStep('mobile');
        else if (found.card.available) void payByCard();
        else setStep('ferme');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(toApiError(caught, 'Les moyens de paiement n’ont pas pu être lus.').message);
        setStep('ferme');
      });
    return () => {
      cancelled = true;
    };
    // Une seule lecture par ouverture : le palier et la durée ne changent pas tant que la fenêtre est ouverte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id, period]);

  const settle = async (status: MobileCheckoutStart['status'], expiresAt: string | null) => {
    if (status === 'paid') {
      await refresh();
      if (closed.current) return;
      setActiveUntil(expiresAt);
      setStep('reussi');
      toast.success('Paiement reçu', { description: expiresAt ? `Votre palier est actif jusqu’au ${formatDateFr(expiresAt)}.` : 'Votre palier est actif.' });
    } else if (status === 'failed' || status === 'expired') {
      setStep('refuse');
    }
  };

  // Pendant la validation sur le téléphone : l'état est relu jusqu'à la réponse de l'opérateur.
  useEffect(() => {
    if (step !== 'attente' || !payment) return;
    const startedAt = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const look = async () => {
      if (stopped) return;
      try {
        const { status, expiresAt } = await billingApi.mobileStatus(payment.reference);
        if (stopped) return;
        if (status !== 'pending') {
          await settle(status, expiresAt);
          return;
        }
      } catch {
        // Une lecture ratée ne dit rien du paiement : la suivante répondra.
      }
      if (stopped) return;
      if (Date.now() - startedAt > WAIT_MS) {
        setStep('plus-tard');
        return;
      }
      timer = setTimeout(() => void look(), POLL_MS);
    };
    timer = setTimeout(() => void look(), POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // `settle` ne lit que des valeurs stables ; le suivi ne dépend que de la demande en cours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, payment]);

  const mobile = methods?.mobile;
  const chosen = mobile?.operators.find((entry) => entry.slug === operator) ?? null;
  const digits = phone.replace(/\D/g, '');
  const canPay = Boolean(chosen) && digits.length >= 6 && (!chosen?.otpRequired || /^\d{4,8}$/.test(otp.trim())) && !busy;

  const payByMobile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chosen || !canPay) return;
    setBusy(true);
    setError(null);
    try {
      const started = await billingApi.mobile({ plan: plan.id, period, operator: chosen.slug, phone, ...(chosen.otpRequired ? { otpCode: otp.trim() } : {}) });
      if (closed.current) return;
      setPayment(started);
      if (started.status === 'pending') setStep('attente');
      else await settle(started.status, started.expiresAt);
    } catch (caught) {
      if (!closed.current) setError(toApiError(caught, 'Le paiement n’a pas pu démarrer : aucun montant n’a été débité.').message);
    } finally {
      if (!closed.current) setBusy(false);
    }
  };

  const summary = (
    <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <span className="font-semibold">Palier {plan.label}</span> · {PERIOD_LABEL[period]}
      {mobile?.amountLabel && step !== 'choix' && step !== 'chargement' && step !== 'ferme' && <span className="float-right font-semibold tabular-nums">{mobile.amountLabel}</span>}
    </p>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === 'mobile' ? 'Payer par Mobile Money' : step === 'attente' ? 'Validez sur votre téléphone' : step === 'reussi' ? 'Paiement reçu' : step === 'refuse' ? 'Paiement non validé' : step === 'plus-tard' ? 'Validation en attente' : 'Choisissez votre moyen de paiement'}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden="true" />
            Paiement sécurisé. Le montant est fixé par Smart Creator, vous le validez vous-même.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {summary}

          {step === 'chargement' && (
            <div className="space-y-3" role="status" aria-label="Lecture des moyens de paiement">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          )}

          {step === 'choix' && mobile && (
            <div className="space-y-3">
              <MethodTile
                icon={<Smartphone className="size-6" aria-hidden="true" />}
                title="Mobile Money"
                description={`Vous validez sur votre téléphone, avec votre code secret${mobile.amountLabel ? ` · ${mobile.amountLabel}` : ''}`}
                marks={mobile.operators.map((entry) => <OperatorMark key={entry.slug} operator={entry} />)}
                onClick={() => setStep('mobile')}
                disabled={busy}
              />
              <MethodTile
                icon={busy ? <Spinner className="size-6" /> : <CreditCard className="size-6" aria-hidden="true" />}
                title="Carte bancaire"
                description="Sur une page de paiement sécurisée"
                marks={['Visa', 'Mastercard'].map((name) => (
                  <span key={name} className="inline-flex items-center rounded-md border bg-background px-2 py-0.5 text-xs font-bold tracking-wide">
                    {name}
                  </span>
                ))}
                onClick={() => void payByCard()}
                disabled={busy}
              />
            </div>
          )}

          {step === 'mobile' && mobile && (
            <form onSubmit={payByMobile} className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Votre opérateur</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {mobile.operators.map((entry) => {
                    const active = entry.slug === operator;
                    return (
                      <label
                        key={entry.slug}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                          active && 'border-primary bg-accent/60',
                        )}
                      >
                        <input type="radio" name="operateur" value={entry.slug} checked={active} onChange={() => setOperator(entry.slug)} className="sr-only" />
                        <OperatorMark operator={entry} className="px-2.5 py-1 text-sm" />
                        {active && <CheckCircle2 className="ml-auto size-4 text-brand-green-text" aria-hidden="true" />}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <Field>
                <FieldLabel htmlFor="paiement-numero">Numéro Mobile Money</FieldLabel>
                <div className="flex items-stretch">
                  {mobile.prefix && <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm font-medium tabular-nums">+{mobile.prefix}</span>}
                  <Input
                    id="paiement-numero"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    maxLength={24}
                    className={cn('tabular-nums', mobile.prefix && 'rounded-l-none')}
                    autoFocus
                  />
                </div>
                <FieldDescription>
                  {digits.length >= 6 ? `La demande partira sur le ${readablePhone(phone, mobile.prefix)}.` : `Le numéro du compte Mobile Money qui paie${mobile.countryName ? `, au ${mobile.countryName}` : ''}.`}
                </FieldDescription>
              </Field>

              {chosen?.otpRequired && (
                <Field>
                  <FieldLabel htmlFor="paiement-code">Code de confirmation {chosen.name}</FieldLabel>
                  <Input id="paiement-code" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))} maxLength={8} className="tabular-nums" />
                  <FieldDescription>
                    {chosen.ussdCode ? `Composez ${chosen.ussdCode} sur votre téléphone : ${chosen.name} vous donne ce code.` : `${chosen.name} vous envoie ce code sur votre téléphone.`}
                  </FieldDescription>
                </Field>
              )}

              {error && (
                <Alert variant="danger">
                  <TriangleAlert />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                {methods?.card.available ? (
                  <Button type="button" variant="ghost" onClick={() => setStep('choix')} disabled={busy}>
                    <ArrowLeft />
                    Autre moyen de paiement
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="submit" disabled={!canPay}>
                  {busy ? <Spinner /> : <Smartphone />}
                  {busy ? 'Envoi de la demande…' : `Payer ${mobile.amountLabel ?? ''}`.trim()}
                </Button>
              </div>
            </form>
          )}

          {step === 'attente' && payment && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border bg-accent/40 p-4" role="status">
                <Spinner className="mt-0.5 size-5 shrink-0" />
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">
                    Une demande de {payment.amountLabel} vient d’arriver sur votre numéro {payment.operator} ({payment.phoneHint}).
                  </p>
                  <p className="text-muted-foreground">Saisissez votre code secret sur votre téléphone pour la valider. Cette fenêtre se met à jour toute seule.</p>
                </div>
              </div>
              {payment.providerLink && (
                <Button asChild className="w-full">
                  <a href={payment.providerLink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink />
                    Ouvrir la page de validation {payment.operator}
                  </a>
                </Button>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">Vous pouvez fermer cette fenêtre : votre palier s’activera de lui-même dès que le paiement sera validé.</p>
            </div>
          )}

          {step === 'plus-tard' && (
            <Alert variant="info">
              <Smartphone />
              <AlertTitle>La validation n’est pas encore arrivée</AlertTitle>
              <AlertDescription>Dès que vous validez sur votre téléphone, votre palier s’active de lui-même : rien d’autre à faire ici.</AlertDescription>
            </Alert>
          )}

          {step === 'reussi' && (
            <Alert variant="success">
              <CheckCircle2 />
              <AlertTitle>Votre palier {plan.label} est actif</AlertTitle>
              <AlertDescription>{activeUntil ? `Il est valable jusqu’au ${formatDateFr(activeUntil)}, et vos points sont crédités.` : 'Vos points sont crédités.'}</AlertDescription>
            </Alert>
          )}

          {step === 'refuse' && (
            <div className="space-y-4">
              <Alert variant="warning">
                <TriangleAlert />
                <AlertTitle>Le paiement n’a pas été validé</AlertTitle>
                <AlertDescription>Aucun montant n’a été débité. La demande a été refusée ou n’a pas été validée à temps sur le téléphone.</AlertDescription>
              </Alert>
              <Button className="w-full" onClick={() => { setError(null); setPayment(null); setStep(methods?.mobile.available ? 'mobile' : 'choix'); }}>
                Reprendre le paiement
              </Button>
            </div>
          )}

          {step === 'ferme' && (
            <Alert variant={error ? 'danger' : 'info'}>
              <TriangleAlert />
              <AlertDescription>{error ?? 'Le paiement en ligne n’est pas ouvert pour votre pays : l’administrateur active ce palier après votre paiement.'}</AlertDescription>
            </Alert>
          )}

          {step === 'choix' && error && (
            <Alert variant="danger">
              <TriangleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {(step === 'reussi' || step === 'plus-tard' || step === 'ferme') && (
            <Button variant={step === 'reussi' ? 'default' : 'outline'} className="w-full" onClick={onClose}>
              Fermer
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
