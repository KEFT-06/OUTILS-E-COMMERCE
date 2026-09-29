import React, { Suspense, createContext, lazy, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { toast } from 'sonner';
import { reloadOnceForNewVersion } from '@/shared/lib/reloadForNewVersion';
import { CreditCostTable, CreditQuote } from '@/shared/types/credits';

/*
  La fenêtre des points ne s'ouvre qu'avant une action payante : elle se charge à part, et
  n'alourdit pas le premier affichage de l'accueil. Montée à la première ouverture, elle le
  reste ensuite (animation de fermeture, réouvertures instantanées).
*/
type SimulatorProps = Parameters<typeof import('@/shared/components/CreditSimulatorDialog').CreditSimulatorDialog>[0];
const loadSimulator = () => import('@/shared/components/CreditSimulatorDialog');
const CreditSimulatorDialog = lazy<React.ComponentType<SimulatorProps>>(() =>
  loadSimulator()
    // Un second essai couvre une coupure passagère du réseau.
    .catch(() => loadSimulator())
    .then((module) => ({ default: module.CreditSimulatorDialog }))
    .catch(() => ({ default: SimulatorUnavailable })),
);

/**
 * Fichier de la fenêtre introuvable : l'action est annulée proprement (rien n'est débité) au
 * lieu de rester suspendue, et la page se recharge si le site a changé de version entre-temps.
 */
function SimulatorUnavailable({ open, onCancel }: SimulatorProps) {
  useEffect(() => {
    if (!open) return;
    onCancel();
    if (!reloadOnceForNewVersion()) toast.error('La confirmation n’a pas pu s’afficher : rechargez la page pour continuer.');
  }, [open, onCancel]);
  return null;
}

/**
 * Porte de crédits — module 8 du cahier des charges.
 *
 * Le CdC exige que le simulateur apparaisse avant **chaque** action consommant
 * des points. Le rendre transversal était donc la seule option tenable : si
 * chaque écran devait instancier sa propre fenêtre de confirmation, la règle
 * serait respectée le jour de son écriture et violée au troisième écran ajouté.
 *
 * Usage :
 *   const { runWithCredits } = useCreditGate();
 *   await runWithCredits('niche_analysis', async () => { ... });
 *
 * L'action n'est exécutée que si l'utilisateur confirme. Le débit, lui, est fait
 * par le serveur : points réservés au lancement, rendus si l'action échoue —
 * facturer un échec serait indéfendable. Le solde réel est relu après chaque action.
 */

interface CreditGateContextType {
  /**
   * Affiche le simulateur puis exécute l'action si elle est confirmée.
   * @returns le résultat de l'action, ou `null` si l'utilisateur a refusé,
   *          si le solde était insuffisant ou si la grille était indisponible.
   */
  /** `units` : volume d'une action facturée par tranche (pages d'un ebook, d'un rapport). */
  runWithCredits: <T>(actionId: string, action: () => Promise<T>, units?: number) => Promise<T | null>;
  /** Grille tarifaire chargée, pour les affichages qui ont besoin du prix du point. */
  costTable: CreditCostTable | null;
}

const CreditGateContext = createContext<CreditGateContextType | undefined>(undefined);

/** La grille ne change qu'au déploiement : un cache de module suffit. */
let costTableCache: CreditCostTable | null = null;

async function loadCostTable(): Promise<CreditCostTable> {
  if (costTableCache) return costTableCache;

  const response = await fetch('/api/credits/costs');

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(
      payload?.error?.message ?? `La grille tarifaire a répondu ${response.status}.`,
    );
  }

  costTableCache = (await response.json()) as CreditCostTable;
  return costTableCache;
}

export const CreditGateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { account, refresh } = useAuth();

  const [quote, setQuote] = useState<CreditQuote | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [simulatorUsed, setSimulatorUsed] = useState(false);
  const [costTable, setCostTable] = useState<CreditCostTable | null>(costTableCache);

  /** Résout la promesse ouverte par `runWithCredits`, au clic de l'utilisateur. */
  const decisionRef = useRef<((approved: boolean) => void) | null>(null);

  // Connecté, on récupère la fenêtre des points en arrière-plan : la première action payante
  // l'ouvre sans attendre le réseau. Un visiteur de l'accueil ne la télécharge pas.
  const connected = Boolean(account);
  useEffect(() => {
    if (connected) void loadSimulator().catch(() => undefined);
  }, [connected]);

  // Préchargement : les écrans qui affichent un solde ont besoin du prix du
  // point sans attendre qu'une action soit déclenchée. Un échec ici est muet —
  // il ressortira au moment où une action réclamera réellement la grille.
  useEffect(() => {
    let cancelled = false;

    loadCostTable()
      .then((table) => {
        if (!cancelled) setCostTable(table);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const closeWith = useCallback((approved: boolean) => {
    setIsOpen(false);
    setQuote(null);
    setUnavailableReason(null);

    const decide = decisionRef.current;
    decisionRef.current = null;
    decide?.(approved);
  }, []);
  const confirm = useCallback(() => closeWith(true), [closeWith]);
  const cancel = useCallback(() => closeWith(false), [closeWith]);

  const runWithCredits = useCallback(
    async <T,>(actionId: string, action: () => Promise<T>, units = 1): Promise<T | null> => {
      let approved = false;
      let cost = 0;

      try {
        const table = await loadCostTable();
        setCostTable(table);

        const definition = table.actions.find((a) => a.id === actionId);
        if (!definition) {
          throw new Error(
            `L'action « ${actionId} » ne figure pas dans la grille tarifaire v${table.version}.`,
          );
        }

        // Même calcul que le serveur : toute tranche entamée est due. La fenêtre annonçait le prix
        // d'une seule tranche (2 points pour un ebook de 40 pages, qui en coûte 8).
        cost = definition.perUnit ? definition.cost * Math.max(1, Math.ceil(units / definition.perUnit)) : definition.cost;
        const unlimited = account?.credits.unlimited ?? false;
        const balanceBefore = account?.credits.total ?? 0;

        setQuote({
          action: definition,
          cost,
          monetaryEquivalent: cost * table.pointValue,
          currency: table.currency,
          balanceBefore,
          balanceAfter: unlimited ? balanceBefore : Math.max(0, balanceBefore - cost),
          sufficient: unlimited || balanceBefore >= cost,
          unlimited,
          tableVersion: table.version,
          ...(table.pointValueStatus ? { pointValueStatus: table.pointValueStatus } : {}),
        });
      } catch (error) {
        // Échec fermé, comme pour la conformité : pas de prix annonçable,
        // pas d'action. Débiter à l'aveugle serait pire que ne rien faire.
        setQuote(null);
        setUnavailableReason(
          error instanceof Error ? error.message : 'Grille tarifaire indisponible.',
        );
      }

      setSimulatorUsed(true);
      setIsOpen(true);
      approved = await new Promise<boolean>((resolve) => {
        decisionRef.current = resolve;
      });

      if (!approved) return null;

      try {
        return await action();
      } finally {
        // Le serveur a réservé, débité ou rendu les points : on relit le solde réel.
        void refresh();
      }
    },
    [account, refresh],
  );

  return (
    <CreditGateContext.Provider value={{ runWithCredits, costTable }}>
      {children}
      {simulatorUsed && (
        <Suspense fallback={null}>
          <CreditSimulatorDialog
            quote={quote}
            unavailableReason={unavailableReason}
            open={isOpen}
            onConfirm={confirm}
            onCancel={cancel}
          />
        </Suspense>
      )}
    </CreditGateContext.Provider>
  );
};

export const useCreditGate = () => {
  const context = useContext(CreditGateContext);
  if (!context) {
    throw new Error('useCreditGate doit être utilisé dans un CreditGateProvider');
  }
  return context;
};
