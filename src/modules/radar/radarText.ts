import type { WatchEventView } from '@/shared/types/radar';

/**
 * Phrase d'un événement du radar, avec ses montants dans la devise de l'utilisateur.
 *
 * Le serveur rédige la phrase au moment du relevé, dans la devise de la boutique : un compte
 * camerounais lisait « 12,00 € » sur le fil d'une boutique qui vend en euros. Les montants sont
 * dans `payload` ; la phrase est donc recomposée ici, et celle du serveur ne sert plus que
 * pour les événements sans montant.
 */
type Format = (amount: number | null | undefined, from?: string | null, options?: { round?: boolean }) => string;

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** Nom du produit, repris de la phrase du serveur quand `payload` ne le porte pas. */
function productName(event: WatchEventView): string | null {
  return str(event.payload.name) ?? /«\s*(.+?)\s*»/.exec(event.summary)?.[1] ?? null;
}

export function eventText(event: WatchEventView, format: Format): string {
  const { payload } = event;
  const name = productName(event);
  const currency = str(payload.currency);

  if (event.kind === 'appeared' && payload.returned !== true && name) {
    const price = num(payload.price);
    return price === null ? `Nouveau produit : « ${name} ».` : `Nouveau produit : « ${name} » à ${format(price, currency, { round: true })}.`;
  }

  if (event.kind === 'price_changed' && name) {
    const from = num(payload.from);
    const to = num(payload.to);
    const fromCurrency = str(payload.fromCurrency) ?? currency;
    if (from !== null && to !== null) {
      // Devise de vente changée : les deux montants, une fois convertis, se comparent enfin.
      if (payload.currencyChanged === true) {
        return `Devise de vente changée sur « ${name} » : ${format(from, fromCurrency, { round: true })} → ${format(to, currency, { round: true })}.`;
      }
      return `Prix ${to > from ? 'augmenté' : 'baissé'} sur « ${name} » : ${format(from, fromCurrency, { round: true })} → ${format(to, currency, { round: true })}.`;
    }
    if (from === null && to !== null) return `Prix affiché sur « ${name} » : ${format(to, currency, { round: true })}.`;
  }

  return event.summary;
}

/** « 4 mois », « 12 jours » : une durée lisible, sans chiffre après la virgule. */
export function dureeLisible(days: number): string {
  if (days < 1) return 'moins d’un jour';
  if (days < 60) return `${days} jour${days > 1 ? 's' : ''}`;
  const mois = Math.floor(days / 30);
  if (mois < 24) return `${mois} mois`;
  const ans = Math.floor(days / 365);
  return `${ans} ans`;
}

/** Jours écoulés depuis une date. */
export function joursDepuis(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}
