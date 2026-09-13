/**
 * Mention légale obligatoire (CdC §9.4) — point d'accès unique côté client.
 *
 * Le texte de référence vit dans la table de conformité du serveur. Ce repli
 * n'existe que pour qu'aucun document ne sorte sans mention si l'API est
 * momentanément absente ; il était auparavant recopié dans chaque composant.
 */
export const FALLBACK_DISCLAIMER =
  'Smart Creator fournit des analyses basées sur des données publiques. ' +
  "Aucun résultat financier n'est garanti.";

let cachedDisclaimer: string | null = null;
let pendingRequest: Promise<string> | null = null;

/** Mention déjà chargée, ou `null` si aucun appel n'a encore abouti. */
export function getCachedDisclaimer(): string | null {
  return cachedDisclaimer;
}

/** Charge la mention depuis la table de conformité. Ne lève jamais. */
export function fetchRequiredDisclaimer(): Promise<string> {
  if (cachedDisclaimer) return Promise.resolve(cachedDisclaimer);
  if (pendingRequest) return pendingRequest;

  pendingRequest = fetch('/api/compliance/rules')
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { requiredDisclaimer?: string } | null) => {
      if (data?.requiredDisclaimer) cachedDisclaimer = data.requiredDisclaimer;
      return cachedDisclaimer ?? FALLBACK_DISCLAIMER;
    })
    .catch(() => FALLBACK_DISCLAIMER)
    .finally(() => {
      pendingRequest = null;
    });

  return pendingRequest;
}
