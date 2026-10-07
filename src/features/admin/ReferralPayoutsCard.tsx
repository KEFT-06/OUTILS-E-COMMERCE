import { useState } from 'react';
import { toast } from 'sonner';
import { useAdminResource } from '@/features/admin/adminApi';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { formatDateFr } from '@/shared/lib/formatDate';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

/**
 * Retraits de parrainage à régler. Le versement se fait hors du site (Mobile Money, virement,
 * crypto) ; ici, l'équipe le marque payé avec sa référence, ou le refuse avec son motif — le
 * parrain lit l'un ou l'autre sur son écran.
 */

interface Payout {
  id: string;
  affiliate: { id: string; name: string; email: string };
  amountFcfa: number;
  method: 'orange_money' | 'mtn_momo' | 'bank' | 'crypto';
  destination: string;
  holderName: string;
  status: 'requested' | 'paid' | 'rejected';
  note: string | null;
  requestedAt: string;
  processedAt: string | null;
}

interface PayoutList {
  payouts: Payout[];
  terms: { mode: 'percent' | 'fixed'; percent: number; fixedFcfa: number; holdDays: number; minPayoutFcfa: number; cookieDays: number };
}

const MOYENS: Record<Payout['method'], string> = { orange_money: 'Orange Money', mtn_momo: 'MTN Mobile Money', bank: 'Virement bancaire', crypto: 'Crypto' };
const fcfa = (amount: number) => `${amount.toLocaleString('fr-FR')} FCFA`;

export function ReferralPayoutsCard({ canSettle }: { canSettle: boolean }) {
  const list = useAdminResource<PayoutList>('/api/admin/referral/payouts');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const settle = async (payout: Payout, decision: 'paid' | 'rejected') => {
    const note = (notes[payout.id] ?? '').trim();
    if (decision === 'rejected' && note.length < 3) {
      toast.error('Indiquez le motif du refus : le parrain le lira.');
      return;
    }
    setBusy(payout.id);
    try {
      await apiRequest(`/api/admin/referral/payouts/${payout.id}`, { method: 'POST', body: { decision, ...(note ? { note } : {}) } });
      toast.success(decision === 'paid' ? `Retrait de ${fcfa(payout.amountFcfa)} marqué payé.` : 'Retrait refusé : le solde est de nouveau disponible pour le parrain.');
      list.reload();
    } catch (caught) {
      toast.error(toApiError(caught, 'Le retrait n’a pas pu être traité.').message);
    } finally {
      setBusy(null);
    }
  };

  const terms = list.data?.terms;
  const payouts = list.data?.payouts ?? [];
  const attente = payouts.filter((payout) => payout.status === 'requested');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Parrainage : retraits à régler{attente.length > 0 ? ` (${attente.length})` : ''}</CardTitle>
        <CardDescription>
          {terms
            ? `Conditions en vigueur : ${terms.mode === 'fixed' ? `${fcfa(terms.fixedFcfa)} par paiement` : `${terms.percent} % de chaque paiement`}, validés après ${terms.holdDays} jours, retrait dès ${fcfa(terms.minPayoutFcfa)}, lien suivi ${terms.cookieDays} jours.`
            : 'Chargement…'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {payouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune demande de retrait pour l’instant.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Demandé le</TableHead>
                <TableHead>Parrain</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Où verser</TableHead>
                <TableHead>État</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.map((payout) => (
                <TableRow key={payout.id}>
                  <TableCell className="whitespace-nowrap">{formatDateFr(payout.requestedAt)}</TableCell>
                  <TableCell>
                    {payout.affiliate.name}
                    <span className="block text-xs text-muted-foreground">{payout.affiliate.email}</span>
                  </TableCell>
                  <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">{fcfa(payout.amountFcfa)}</TableCell>
                  <TableCell>
                    {MOYENS[payout.method]} · {payout.holderName}
                    <span className="block font-mono text-xs select-all">{payout.destination}</span>
                  </TableCell>
                  <TableCell className="min-w-64">
                    {payout.status !== 'requested' ? (
                      <>
                        <Badge variant={payout.status === 'paid' ? 'success' : 'secondary'}>{payout.status === 'paid' ? 'Payé' : 'Refusé'}</Badge>
                        {payout.note && <span className="block text-xs text-muted-foreground">{payout.note}</span>}
                      </>
                    ) : canSettle ? (
                      <div className="flex flex-col gap-2">
                        <Input
                          value={notes[payout.id] ?? ''}
                          onChange={(change) => setNotes((previous) => ({ ...previous, [payout.id]: change.target.value }))}
                          placeholder="Référence du versement, ou motif du refus"
                          aria-label={`Référence ou motif pour le retrait de ${payout.affiliate.name}`}
                          maxLength={300}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={busy === payout.id} onClick={() => void settle(payout, 'paid')}>
                            Marquer payé
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy === payout.id} onClick={() => void settle(payout, 'rejected')}>
                            Refuser
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Badge variant="secondary">À régler</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
