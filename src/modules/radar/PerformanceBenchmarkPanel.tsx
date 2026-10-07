import { useCallback, useEffect, useState } from 'react';
import { Gauge, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { toApiError } from '@/shared/lib/apiError';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Progress } from '@/shared/ui/progress';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Où le vendeur se situe parmi ceux de sa niche.
 *
 * Le radar mesure les CONCURRENTS ; l'analyse mesure le MARCHÉ. Il manquait le seul chiffre
 * qui parle vraiment à un vendeur : le sien, rapporté aux autres. « Vos produits se vendent
 * douze fois par mois ; la médiane de votre niche est à trente-quatre » est une phrase
 * qu'aucun autre écran ne peut produire, et c'est celle qui fait agir.
 *
 * TROIS ÉTATS, ET CHACUN DOIT ÊTRE UTILE :
 *
 *  · pas encore participant — on explique ce qu'on obtient et ce qu'on donne, puis on
 *    propose. Verser ses chiffres de vente dans un calcul commun se demande ;
 *  · participant, mais moins de cinq vendeurs dans la niche — on montre SES chiffres et on
 *    dit combien il en manque. Une page vide pendant des semaines ferait croire à une panne,
 *    et le repère n'arriverait jamais puisque personne ne resterait inscrit ;
 *  · repère publiable — on montre l'écart, et on le nomme. Un chiffre à côté d'un autre
 *    laisse le lecteur faire la soustraction ; le dire explicitement lui fait gagner ce pas.
 *
 * Le seuil de cinq vendeurs n'est pas un réglage d'affichage : dans une niche étroite, une
 * médiane calculée sur deux vendeurs les désigne. Il ne se contourne pas.
 */

interface PerformanceView {
  optedIn: boolean;
  group: { niche: string; market: string } | null;
  own: { salesPerMonth: number; products: number; salesPerProduct: number } | null;
  medians: Record<string, number> | null;
  sellers: number;
  sellersNeeded: number;
  minSellers: number;
}

const MESURES: { cle: keyof NonNullable<PerformanceView['own']>; label: string; unite: string }[] = [
  { cle: 'salesPerMonth', label: 'Ventes sur 30 jours', unite: '' },
  { cle: 'products', label: 'Produits en vente', unite: '' },
  { cle: 'salesPerProduct', label: 'Ventes par produit', unite: '' },
];

/** Écart en pourcentage, borné à un affichage lisible. `null` : la médiane est à zéro. */
function ecart(mien: number, median: number): number | null {
  if (median === 0) return null;
  return Math.round((mien / median - 1) * 100);
}

function Comparaison({ label, mien, median }: { label: string; mien: number; median: number | undefined }) {
  const delta = median === undefined ? null : ecart(mien, median);
  const dessus = delta !== null && delta >= 0;

  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-display text-2xl font-extrabold tabular-nums">{mien.toLocaleString('fr-FR')}</span>
        {median !== undefined && (
          <span className="text-sm text-muted-foreground tabular-nums">médiane {median.toLocaleString('fr-FR')}</span>
        )}
      </div>
      {delta !== null && (
        <p className={`flex items-center gap-1 text-xs font-medium ${dessus ? 'text-success' : 'text-amber-600 dark:text-amber-500'}`}>
          {dessus ? <TrendingUp className="size-3.5" aria-hidden="true" /> : <TrendingDown className="size-3.5" aria-hidden="true" />}
          {dessus ? `+${delta} % au-dessus` : `${delta} % en dessous`}
        </p>
      )}
    </div>
  );
}

export function PerformanceBenchmarkPanel() {
  const [data, setData] = useCachedState<PerformanceView>('/api/market/performance');
  const [busy, setBusy] = useState(false);

  const charger = useCallback(() => {
    apiRequest<PerformanceView>('/api/market/performance')
      .then(setData)
      // Ce panneau est un complément : s'il ne répond pas, le radar reste lisible sans lui.
      .catch(() => undefined);
  }, [setData]);

  useEffect(charger, [charger]);

  async function basculer(enabled: boolean) {
    setBusy(true);
    try {
      setData(await apiRequest<PerformanceView>('/api/market/performance/opt-in', { method: 'POST', body: { enabled } }));
      toast.success(
        enabled ? 'Vous participez au repère' : 'Participation retirée',
        { description: enabled ? 'Vos chiffres sont relevés une fois par jour.' : 'Vos relevés ont été effacés.' },
      );
    } catch (error) {
      toast.error('Le réglage n’a pas été enregistré', { description: toApiError(error, 'Le serveur n’a pas répondu.').message });
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  /*
    Sans niche analysée, il n'y a pas de groupe de comparaison — et comparer quelqu'un à une
    niche qu'il n'a pas choisie ne dirait rien de juste. On ne montre rien plutôt que de
    proposer une participation qui ne mènerait nulle part.
  */
  if (!data.group) return null;

  const publie = data.medians !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-brand-green-text" aria-hidden="true" />
          Où vous vous situez
        </CardTitle>
        <CardDescription>
          Vos chiffres comparés à ceux des autres vendeurs de la niche « {data.group.niche} ».
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!data.optedIn ? (
          <>
            <p className="text-sm leading-relaxed">
              Partagez trois chiffres (ventes du mois, nombre de produits, ventes par produit) et recevez la médiane de votre
              niche. Aucun nom de produit ni de client n’est partagé, et vous pouvez vous retirer à tout moment.
            </p>
            <Button onClick={() => void basculer(true)} disabled={busy}>
              {busy ? <Spinner /> : <Users />}
              Participer au repère
            </Button>
          </>
        ) : (
          <>
            {data.own ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {MESURES.map((mesure) => (
                  <Comparaison
                    key={mesure.cle}
                    label={mesure.label}
                    mien={data.own![mesure.cle]}
                    median={publie ? data.medians![mesure.cle] : undefined}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Reliez votre boutique dans <span className="font-medium">Mon compte → Connexions</span> pour voir vos chiffres ici.
              </p>
            )}

            {/*
              L'attente doit se voir avancer, sinon elle passe pour une panne. Une barre et un
              compte disent où en est le groupe — et qu'il progresse.
            */}
            {!publie && (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {data.sellers} vendeur{data.sellers > 1 ? 's' : ''} sur {data.minSellers}
                  </p>
                  <Badge variant="outline">
                    Encore {data.sellersNeeded} pour afficher la médiane
                  </Badge>
                </div>
                <Progress value={(data.sellers / data.minSellers) * 100} aria-label="Vendeurs réunis dans votre niche" />
              </div>
            )}

            {publie && (
              <p className="text-sm text-muted-foreground">Médiane de {data.sellers} vendeurs de votre niche, sur 90 jours.</p>
            )}

            <Button variant="ghost" size="sm" onClick={() => void basculer(false)} disabled={busy}>
              Retirer ma participation
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
