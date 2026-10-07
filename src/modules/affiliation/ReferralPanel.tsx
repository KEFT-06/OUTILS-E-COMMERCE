import { useCallback, useEffect, useState } from 'react';
import { Banknote, Check, Copy, MousePointerClick, Send, UserPlus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { useMoney } from '@/shared/lib/money';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Spinner } from '@/shared/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

/**
 * Parrainage : le lien du compte, ce qu'il a rapporté, et la demande de retrait.
 *
 * Tout ce que l'écran promet vient du serveur (taux, délai de garde, minimum de retrait) : il ne
 * peut pas annoncer une commission que le calcul n'applique pas. Les montants, tenus en francs
 * CFA, sont affichés dans la devise du compte.
 */

type Method = 'orange_money' | 'mtn_momo' | 'bank' | 'crypto';

interface Referral {
  code: string;
  link: string;
  altLink: string;
  terms: { mode: 'percent' | 'fixed'; percent: number; fixedFcfa: number; holdDays: number; minPayoutFcfa: number; cookieDays: number };
  clicks: number;
  signups: number;
  customers: number;
  balances: { pending: number; available: number; requested: number; paid: number };
  commissions: { id: string; amountFcfa: number; baseFcfa: number; status: string; createdAt: string; approveAt: string; referred: string }[];
  payouts: { id: string; amountFcfa: number; method: Method; destination: string; status: 'requested' | 'paid' | 'rejected'; note: string | null; requestedAt: string; processedAt: string | null }[];
}

const METHODS: Record<Method, { label: string; champ: string; exemple: string }> = {
  orange_money: { label: 'Orange Money', champ: 'Numéro Orange Money', exemple: '+237 6 99 00 00 00' },
  mtn_momo: { label: 'MTN Mobile Money', champ: 'Numéro MTN Mobile Money', exemple: '+237 6 70 00 00 00' },
  bank: { label: 'Virement bancaire', champ: 'IBAN ou numéro de compte', exemple: 'CM21 1000 2000 3000 …' },
  crypto: { label: 'Crypto (USDT)', champ: 'Adresse du portefeuille', exemple: 'Adresse USDT (réseau TRC-20)' },
};

const STATUTS: Record<string, { label: string; variant: 'secondary' | 'outline' | 'success' }> = {
  pending: { label: 'En attente', variant: 'outline' },
  approved: { label: 'Validée', variant: 'secondary' },
  requested: { label: 'En cours de versement', variant: 'secondary' },
  paid: { label: 'Versée', variant: 'success' },
  cancelled: { label: 'Annulée (paiement remboursé)', variant: 'outline' },
};

const RETRAITS: Record<Referral['payouts'][number]['status'], { label: string; variant: 'secondary' | 'outline' | 'success' }> = {
  requested: { label: 'En cours de traitement', variant: 'secondary' },
  paid: { label: 'Versé', variant: 'success' },
  rejected: { label: 'Refusé', variant: 'outline' },
};

function PayoutDialog({ available, format, onDone }: { available: number; format: (amount: number) => string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>('orange_money');
  const [destination, setDestination] = useState('');
  const [holderName, setHolderName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/referral/payouts', { method: 'POST', body: { method, destination: destination.trim(), holderName: holderName.trim() } });
      toast.success('Demande de retrait enregistrée', { description: 'Votre versement est en cours de traitement.' });
      setOpen(false);
      onDone();
    } catch (caught) {
      toast.error(toApiError(caught, 'La demande n’a pas pu être enregistrée.').message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Banknote />
          Retirer {format(available)}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Retirer {format(available)}</DialogTitle>
            <DialogDescription>Tout votre solde validé part dans cette demande. Indiquez où le recevoir.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="retrait-moyen">Moyen de versement</FieldLabel>
            <Select value={method} onValueChange={(value) => setMethod(value as Method)}>
              <SelectTrigger id="retrait-moyen" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(METHODS) as Method[]).map((id) => (
                  <SelectItem key={id} value={id}>
                    {METHODS[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="retrait-destination">{METHODS[method].champ}</FieldLabel>
            <Input id="retrait-destination" value={destination} onChange={(change) => setDestination(change.target.value)} placeholder={METHODS[method].exemple} maxLength={120} autoComplete="off" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="retrait-titulaire">Nom du titulaire</FieldLabel>
            <Input id="retrait-titulaire" value={holderName} onChange={(change) => setHolderName(change.target.value)} maxLength={120} required />
            <FieldDescription>Le nom auquel le compte de versement est enregistré.</FieldDescription>
          </Field>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy || destination.trim().length < 6 || holderName.trim().length < 2}>
              {busy ? <Spinner className="size-4" /> : <Send />}
              Demander le retrait
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReferralPanel() {
  const money = useMoney();
  const [data, setData] = useCachedState<Referral>('/api/referral');
  const [copie, setCopie] = useState(false);
  const fcfa = (amount: number) => money.format(amount, 'XAF', { round: true });

  const load = useCallback(() => {
    apiRequest<Referral>('/api/referral')
      .then(setData)
      .catch(() => undefined);
  }, [setData]);
  useEffect(load, [load]);

  if (!data) return <Skeleton className="h-64 rounded-xl" />;

  const { terms, balances } = data;
  const gain = terms.mode === 'fixed' ? `${fcfa(terms.fixedFcfa)} par paiement` : `${terms.percent.toLocaleString('fr-FR')} % de chaque paiement`;
  const retraitPossible = balances.available > 0 && balances.available >= terms.minPayoutFcfa;
  const message = `Je crée et je vends mes produits numériques avec Smart Creator. Essaie par ici : ${data.link}`;

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(data.link);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2500);
    } catch {
      toast.info('Sélectionnez le lien pour le copier.');
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Votre lien de parrainage</CardTitle>
          <CardDescription>
            Partagez-le : vous touchez {gain} des personnes qui s’inscrivent par ce lien dans les {terms.cookieDays} jours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={data.link} readOnly aria-label="Votre lien de parrainage" className="font-medium" onFocus={(focus) => focus.target.select()} />
            <Button onClick={() => void copier()} variant="secondary">
              {copie ? <Check /> : <Copy />}
              {copie ? 'Copié' : 'Copier le lien'}
            </Button>
            <Button asChild variant="outline">
              <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer noopener">
                <Send />
                Partager sur WhatsApp
              </a>
            </Button>
          </div>
          <ol className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <li className="rounded-lg border bg-muted/30 p-3">
              <p className="font-semibold">1. Partagez votre lien</p>
              <p className="text-muted-foreground">La personne qui le suit vous est rattachée à son inscription.</p>
            </li>
            <li className="rounded-lg border bg-muted/30 p-3">
              <p className="font-semibold">2. Elle choisit un palier</p>
              <p className="text-muted-foreground">Chacun de ses paiements vous rapporte {gain.replace(' de chaque paiement', '')}, validés après {terms.holdDays} jours.</p>
            </li>
            <li className="rounded-lg border bg-muted/30 p-3">
              <p className="font-semibold">3. Retirez vos gains</p>
              <p className="text-muted-foreground">Dès {fcfa(terms.minPayoutFcfa)} validés : Mobile Money, virement ou crypto.</p>
            </li>
          </ol>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { icon: MousePointerClick, value: data.clicks, label: `visite${data.clicks > 1 ? 's' : ''} par votre lien` },
          { icon: UserPlus, value: data.signups, label: `inscription${data.signups > 1 ? 's' : ''}` },
          { icon: Wallet, value: data.customers, label: `client${data.customers > 1 ? 's' : ''} payant${data.customers > 1 ? 's' : ''}` },
        ].map(({ icon: Icon, value, label }) => (
          <Card key={label} className="py-4">
            <CardContent className="flex items-center gap-3">
              <Icon className="size-5 shrink-0 text-brand-green-text" aria-hidden="true" />
              <div>
                <p className="font-display text-2xl font-extrabold tabular-nums">{value.toLocaleString('fr-FR')}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vos gains</CardTitle>
          <CardDescription>Une commission est validée {terms.holdDays} jours après le paiement, s’il n’a pas été remboursé.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'Disponible', amount: balances.available, fort: true },
              { label: 'En attente de validation', amount: balances.pending },
              { label: 'En cours de versement', amount: balances.requested },
              { label: 'Déjà versé', amount: balances.paid },
            ].map(({ label, amount, fort }) => (
              <div key={label} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`font-display text-xl font-bold tabular-nums ${fort ? 'text-brand-green-text' : ''}`}>{fcfa(amount)}</p>
              </div>
            ))}
          </div>
          {retraitPossible ? (
            <PayoutDialog available={balances.available} format={fcfa} onDone={load} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {balances.requested > 0
                ? 'Votre demande de retrait est en cours de traitement.'
                : `Le retrait s’ouvre dès ${fcfa(terms.minPayoutFcfa)} de commissions validées${balances.available > 0 ? ` : il vous manque ${fcfa(terms.minPayoutFcfa - balances.available)}` : ''}.`}
            </p>
          )}
        </CardContent>
      </Card>

      {data.commissions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Commissions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Filleul</TableHead>
                  <TableHead className="text-right">Paiement</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead>État</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.commissions.map((commission) => {
                  const statut = STATUTS[commission.status] ?? STATUTS.pending!;
                  return (
                    <TableRow key={commission.id}>
                      <TableCell className="whitespace-nowrap">{formatDateFr(commission.createdAt)}</TableCell>
                      <TableCell>{commission.referred}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">{fcfa(commission.baseFcfa)}</TableCell>
                      <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">{fcfa(commission.amountFcfa)}</TableCell>
                      <TableCell>
                        <Badge variant={statut.variant}>{statut.label}</Badge>
                        {commission.status === 'pending' && <span className="block text-xs text-muted-foreground">validée le {formatDateFr(commission.approveAt)}</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data.payouts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Retraits</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Demandé le</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead>Versement</TableHead>
                  <TableHead>État</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.payouts.map((payout) => (
                  <TableRow key={payout.id}>
                    <TableCell className="whitespace-nowrap">{formatDateFr(payout.requestedAt)}</TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">{fcfa(payout.amountFcfa)}</TableCell>
                    <TableCell>
                      {METHODS[payout.method].label}
                      <span className="block text-xs text-muted-foreground">{payout.destination}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={RETRAITS[payout.status].variant}>{RETRAITS[payout.status].label}</Badge>
                      {payout.note && <span className="block text-xs text-muted-foreground">{payout.note}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
