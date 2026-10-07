import { useEffect, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { Handshake } from 'lucide-react';
import { apiRequest } from '@/shared/lib/api';
import { REFERRAL_CODE, followReferral, rememberReferral, rememberedReferral } from '@/shared/lib/referral';
import { Button } from '@/shared/ui/button';

/**
 * Arrivée par un lien de parrainage : « /r/CODE » ou « /?ref=CODE ».
 *
 * La visite est comptée, et le code vaut pour cette visite — sans rien écrire sur l'appareil.
 * Le RETENIR trente jours, lui, demande un accord : ce cookie ne sert pas au visiteur, il sert à
 * créditer la personne qui l'a envoyé. D'où deux boutons d'égale valeur, et aucun dépôt avant la
 * réponse. Refuser n'enlève rien : s'inscrire pendant cette visite rattache quand même le compte.
 */

/** Suit « ?ref= » sur n'importe quelle page publique, et demande s'il faut le retenir. */
export function ReferralCapture() {
  const { search } = useLocation();
  const [propose, setPropose] = useState<string | null>(null);

  useEffect(() => {
    const brut = new URLSearchParams(search).get('ref');
    if (!brut || !REFERRAL_CODE.test(brut)) return;
    const code = brut.toUpperCase();
    followReferral(code);
    // Déjà retenu par ce navigateur : rien à compter une seconde fois, rien à redemander.
    if (rememberedReferral() === code) return;
    let actif = true;
    apiRequest<{ followed: boolean }>('/api/referral/visit', { method: 'POST', body: { code } })
      .then(({ followed }) => {
        if (actif && followed) setPropose(code);
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [search]);

  if (!propose) return null;

  const retenir = () => {
    rememberReferral(propose);
    void apiRequest('/api/referral/visit', { method: 'POST', body: { code: propose, remember: true } }).catch(() => undefined);
    setPropose(null);
  };

  return (
    <aside
      role="dialog"
      aria-label="Parrainage"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl flex-col gap-3 rounded-xl border bg-background p-4 shadow-lg sm:flex-row sm:items-center"
    >
      <Handshake className="hidden size-5 shrink-0 text-brand-green-text sm:block" aria-hidden="true" />
      <p className="flex-1 text-sm leading-relaxed">
        Vous arrivez par le lien d’un membre. Souhaitez-vous que ce parrainage soit retenu 30 jours, pour qu’il en soit crédité si vous vous inscrivez plus tard ?
      </p>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => setPropose(null)}>
          Ne pas retenir
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={retenir}>
          Retenir
        </Button>
      </div>
    </aside>
  );
}

/** « /r/CODE » : le lien court. Il mène à l'accueil, le code suivi au passage. */
export function ReferralLinkPage() {
  const { code } = useParams();
  return <Navigate to={code && REFERRAL_CODE.test(code) ? `/?ref=${encodeURIComponent(code.toUpperCase())}` : '/'} replace />;
}
