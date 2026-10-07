import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { pathOf } from '@/app/navigation';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { ComplianceBlockedError, exportReportPDF } from '@/shared/lib/complianceGate';
import { useMoney } from '@/shared/lib/money';
import type { AnalysisJob, MarketAnalysisReport, ReportSummary } from '@/shared/types/analysis';
import type { ReportComplianceVerdict } from '@/shared/types/compliance';
import { ComplianceBlockDialog } from '@/shared/components/ComplianceBlockDialog';

/**
 * État de l'espace de travail partagé par tous les écrans : rapports du compte
 * (conservés sur le serveur, jamais d'exemple fabriqué), niche active, analyse et
 * export PDF, fenêtres ouvertes depuis l'en-tête ou la palette ⌘K.
 */
interface WorkspaceContextType {
  reports: ReportSummary[];
  currentReport: MarketAnalysisReport | null;
  /** Vrai pendant le chargement des rapports ou l'ouverture de l'un d'eux. */
  isLoadingReport: boolean;
  selectReport: (id: string) => void;
  deleteReport: (id: string) => Promise<void>;
  /** Efface tout l'historique des niches analysées du compte. */
  deleteAllReports: () => Promise<void>;
  isAnalyzing: boolean;
  /** Analyse en cours du compte (étude puis rédaction), suivie jusqu'à son terme. */
  analysisJob: AnalysisJob | null;
  analyzeNiche: (query: string, market?: string | null) => Promise<void>;
  /** Renonce à l'analyse en cours : points rendus, compte libéré immédiatement. */
  cancelAnalysis: () => Promise<void>;
  isExportingPdf: boolean;
  exportPdf: () => Promise<void>;
  analysisDialogOpen: boolean;
  setAnalysisDialogOpen: (open: boolean) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

/** Seul l'identifiant du dernier rapport ouvert reste dans le navigateur : le rapport, lui, est sur le compte. */
const activeReportKey = (accountId: string) => `smartcreator_rapport_actif_${accountId}`;

function rememberActiveReport(accountId: string, reportId: string | null) {
  try {
    if (reportId) localStorage.setItem(activeReportKey(accountId), reportId);
    else localStorage.removeItem(activeReportKey(accountId));
  } catch {
    // Stockage bloqué : on rouvrira simplement le rapport le plus récent.
  }
}

function rememberedActiveReport(accountId: string): string | null {
  try {
    return localStorage.getItem(activeReportKey(accountId));
  } catch {
    return null;
  }
}

/** Le rapport le plus récent que ce navigateur a déjà vu : sert à reconnaître une analyse arrivée pendant l'absence. */
const newestSeenKey = (accountId: string) => `smartcreator_rapport_recent_${accountId}`;

function rememberNewestReport(accountId: string, reportId: string) {
  try {
    localStorage.setItem(newestSeenKey(accountId), reportId);
  } catch {
    // Stockage bloqué : le dernier rapport ouvert servira de repère.
  }
}

/**
 * Rapport à ouvrir à l'arrivée. Le dernier que l'utilisateur avait ouvert — sauf si une analyse
 * s'est terminée depuis sa dernière visite (écran fermé, autre appareil) : c'est alors elle qu'il
 * vient chercher, et rouvrir l'ancienne lui faisait croire que la nouvelle n'avait pas abouti.
 */
function reportToOpen(accountId: string, list: ReportSummary[]): ReportSummary | undefined {
  const newest = list[0];
  if (!newest) return undefined;
  let seen: string | null = null;
  try {
    seen = localStorage.getItem(newestSeenKey(accountId));
  } catch {
    seen = null;
  }
  if (seen && seen !== newest.id && list.some((entry) => entry.id === seen)) return newest;
  return list.find((entry) => entry.id === rememberedActiveReport(accountId)) ?? newest;
}

/** Attente avant un nouvel essai de chargement : 2 s, 4 s, 8 s… jusqu'à 30 s. */
const retryDelay = (attempt: number) => Math.min(30_000, 2_000 * 2 ** attempt);

const summaryOf = (report: MarketAnalysisReport): ReportSummary => ({
  id: report.id,
  query: report.query,
  nicheName: report.nicheName,
  market: report.market ?? null,
  createdAt: report.generator?.generatedAt ?? new Date().toISOString(),
});

const fetchReport = (id: string) => apiRequest<{ report: MarketAnalysisReport }>(`/api/reports/${encodeURIComponent(id)}`);

/** Un rapport supprimé ou étranger au compte : insister ne servirait à rien. */
const isGone = (error: unknown) => toApiError(error, '').status === 404;

/** Cadence du suivi d'une analyse : l'étude dure une à plusieurs minutes. */
const JOB_POLL_MS = 3_000;
/**
 * Cadence pendant une attente. Une analyse qui attend que le fournisseur se libère peut patienter
 * vingt minutes : la sonder toutes les trois secondes ferait quatre cents requêtes pour rien.
 * C'est pourtant cette sonde qui la relancera — d'où un rythme lent, mais pas nul.
 */
const JOB_WAIT_POLL_MS = 20_000;

const JOB_STEPS: Record<AnalysisJob['status'], string> = {
  queued: 'Préparation de l’analyse…',
  research: 'Étude de marché sur le web en cours : comptez 1 à 3 minutes.',
  writing: 'Rédaction du rapport à partir des sources trouvées…',
  waiting: 'Rédaction du rapport à partir des sources trouvées…',
  completed: 'Rapport prêt.',
  failed: 'L’analyse n’a pas abouti.',
};

export const analysisStepLabel = (status: AnalysisJob['status']) => JOB_STEPS[status];

/**
 * Étape du suivi. Une analyse qui attend un nouvel essai se présente comme une rédaction en
 * cours : la reprise est automatique, l'utilisateur n'a rien à faire ni à attendre de précis
 * (décision du 29/09/2026 : plus de « service très demandé, réessai à… » à l'écran).
 */
function stepDescription(status: AnalysisJob['status']): string {
  return JOB_STEPS[status === 'waiting' ? 'writing' : status];
}

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const { runWithCredits } = useCreditGate();
  const { account, refresh } = useAuth();
  const accountId = account?.id;
  const money = useMoney();

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [currentReport, setCurrentReport] = useState<MarketAnalysisReport | null>(null);
  /** La liste des rapports du compte a été lue : on SAIT s'il y en a. */
  const [reportsKnown, setReportsKnown] = useState(false);
  /** Un rapport est en cours d'ouverture, à la demande de l'utilisateur. */
  const [isOpeningReport, setIsOpeningReport] = useState(false);
  /*
    « En chargement » tant qu'un rapport est attendu et pas encore là : liste pas encore lue, ou
    rapports présents sur le compte mais aucun ouvert. Les écrans n'affirment donc « aucune niche
    analysée » que lorsque c'est établi. Un seul chargement manqué — connexion instable — laissait
    tous les modules dire qu'on n'avait rien analysé, alors que l'analyse était sur le compte
    (signalé par le propriétaire le 06/10/2026).
  */
  const isLoadingReport = !reportsKnown || isOpeningReport || (reports.length > 0 && currentReport === null);
  const [analysisJob, setAnalysisJob] = useState<AnalysisJob | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [blockedVerdict, setBlockedVerdict] = useState<ReportComplianceVerdict | null>(null);

  // Rapports du compte, à l'arrivée. Un chargement manqué est repris de lui-même, jusqu'à aboutir.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setReportsKnown(false);
    setReports([]);
    setCurrentReport(null);

    const load = async (attempt: number) => {
      try {
        const { reports: list } = await apiRequest<{ reports: ReportSummary[] }>('/api/reports');
        if (cancelled) return;
        setReports(list);
        setReportsKnown(true);
      } catch {
        if (cancelled) return;
        // Connexion instable : rien n'est affirmé à l'écran, et le chargement repart tout seul.
        timer = setTimeout(() => void load(attempt + 1), retryDelay(attempt));
      }
    };
    void load(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accountId]);

  /*
    Des rapports sur le compte, aucun d'ouvert, et l'utilisateur n'en ouvre pas un lui-même :
    l'écran ouvre celui qu'il attend, et recommence tant que ce n'est pas fait. C'est le seul
    endroit qui s'en charge — à l'arrivée, après une suppression, après un chargement manqué.
  */
  const [autoOpenAttempt, setAutoOpenAttempt] = useState(0);
  useEffect(() => {
    if (!accountId || !reportsKnown || reports.length === 0 || currentReport !== null || isOpeningReport) return;
    const target = reportToOpen(accountId, reports);
    if (!target) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        fetchReport(target.id)
          .then(({ report }) => {
            if (cancelled) return;
            setCurrentReport(report);
            setAutoOpenAttempt(0);
            rememberActiveReport(accountId, report.id);
            rememberNewestReport(accountId, reports[0]!.id);
          })
          .catch((error: unknown) => {
            if (cancelled) return;
            // Supprimé depuis un autre appareil : on l'oublie, le suivant sera ouvert à sa place.
            if (isGone(error)) setReports((previous) => previous.filter((entry) => entry.id !== target.id));
            else setAutoOpenAttempt((attempt) => attempt + 1);
          });
      },
      autoOpenAttempt === 0 ? 0 : retryDelay(autoOpenAttempt - 1),
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accountId, reportsKnown, reports, currentReport, isOpeningReport, autoOpenAttempt]);

  // Analyse lancée avant un rechargement de la page : le suivi reprend.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    apiRequest<{ job: AnalysisJob | null }>('/api/analyze-niche/jobs/active')
      .then(({ job }) => {
        if (!cancelled && job) setAnalysisJob(job);
      })
      .catch(() => {
        // Sans réponse, rien à reprendre : l'analyse éventuelle continue sur le serveur.
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const openReport = useCallback(
    async (id: string) => {
      setIsOpeningReport(true);
      try {
        // Trois essais avant de le dire : une coupure d'une seconde ne doit pas se voir.
        for (let attempt = 0; ; attempt += 1) {
          try {
            const { report } = await fetchReport(id);
            setCurrentReport(report);
            if (accountId) rememberActiveReport(accountId, report.id);
            return;
          } catch (error) {
            if (attempt >= 2 || isGone(error)) throw error;
            await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
          }
        }
      } catch (error) {
        toast.error('Le rapport n’a pas pu être ouvert', { description: toApiError(error, 'Votre connexion semble instable.').message });
      } finally {
        setIsOpeningReport(false);
      }
    },
    [accountId],
  );

  const selectReport = useCallback(
    (id: string) => {
      if (currentReport?.id === id) return;
      void openReport(id);
    },
    [currentReport?.id, openReport],
  );

  const deleteReport = useCallback(
    async (id: string) => {
      try {
        await apiRequest(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch (error) {
        toast.error('Le rapport n’a pas pu être supprimé', { description: toApiError(error, 'Le serveur n’a pas répondu.').message });
        return;
      }
      const remaining = reports.filter((entry) => entry.id !== id);
      setReports(remaining);
      if (currentReport?.id === id) {
        setCurrentReport(null);
        if (accountId) rememberActiveReport(accountId, null);
        if (remaining[0]) void openReport(remaining[0].id);
      }
      toast.success('Rapport supprimé');
    },
    [accountId, currentReport?.id, openReport, reports],
  );

  const deleteAllReports = useCallback(async () => {
    try {
      await apiRequest('/api/reports', { method: 'DELETE' });
    } catch (error) {
      toast.error('L’historique n’a pas pu être effacé', { description: toApiError(error, 'Relancez la suppression.').message });
      return;
    }
    setReports([]);
    setCurrentReport(null);
    if (accountId) rememberActiveReport(accountId, null);
    toast.success('Historique effacé');
  }, [accountId]);

  /**
   * Analyse d'une nouvelle niche, derrière la porte de crédits : le coût s'affiche avant le
   * lancement, les points sont rendus par le serveur si l'analyse échoue. Le serveur répond
   * tout de suite ; le suivi ci-dessous affiche chaque étape jusqu'au rapport. Aucun rapport de
   * repli n'est fabriqué : l'erreur du serveur est montrée telle quelle, elle dit ce qui manque.
   */
  const analyzeNiche = useCallback(
    async (query: string, market?: string | null) => {
      try {
        await runWithCredits('niche_analysis', async () => {
          const { job } = await apiRequest<{ job: AnalysisJob }>('/api/analyze-niche', {
            method: 'POST',
            body: { query, ...(market ? { market } : {}) },
          });
          if (job.query !== query) {
            toast.info('Une analyse est déjà en cours', { description: `« ${job.query} » : son rapport arrive d’abord.` });
          }
          setAnalysisJob(job);
        });
      } catch (error) {
        toast.error('L’analyse n’a pas pu être lancée', { description: toApiError(error, 'Erreur inconnue.').message });
      }
    },
    [runWithCredits],
  );

  /**
   * Renoncer à l'analyse en cours. Sans cette sortie, une niche mal saisie coûtait
   * plusieurs minutes d'attente avant de pouvoir en relancer une autre : une seule analyse
   * tourne à la fois par compte. Les points sont rendus par le serveur.
   */
  const cancelAnalysis = useCallback(async () => {
    if (!analysisJob) return;
    try {
      await apiRequest(`/api/analyze-niche/jobs/${encodeURIComponent(analysisJob.id)}`, { method: 'DELETE' });
      setAnalysisJob(null);
      toast.success('Analyse annulée', { description: 'Vos points ont été rendus.', id: `analyse-${analysisJob.id}`, duration: 6_000 });
      void refresh();
    } catch (error) {
      toast.error('L’analyse n’a pas pu être annulée', { description: toApiError(error, 'Le serveur n’a pas répondu.').message });
    }
  }, [analysisJob, refresh]);

  // Suivi de l'analyse en cours, étape par étape, jusqu'au rapport.
  const analysisJobId = analysisJob?.id;
  const analysisJobStatus = analysisJob?.status;
  const analysisJobRetryAfter = analysisJob?.retryAfter ?? null;
  const analysisJobErrorCode = analysisJob?.error?.code ?? null;
  useEffect(() => {
    if (!analysisJobId || analysisJobStatus === 'completed' || analysisJobStatus === 'failed') return;
    const toastId = `analyse-${analysisJobId}`;
    toast.loading('Analyse en cours', {
      id: toastId,
      description: stepDescription(analysisJobStatus ?? 'queued'),
      duration: Infinity,
    });

    let cancelled = false;
    let failures = 0;
    /** Un passage du suivi est en cours : le suivant attend, pour ne pas charger deux fois le rapport. */
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      apiRequest<{ job: AnalysisJob }>(`/api/analyze-niche/jobs/${encodeURIComponent(analysisJobId)}`)
        .then(async ({ job }) => {
          if (cancelled) return;
          failures = 0;
          if (job.status === 'completed' && job.reportId) {
            /*
              Le suivi ne s'arrête qu'une fois le rapport réellement chargé. Il s'arrêtait AVANT :
              si ce dernier chargement échouait — le rapport pèse bien plus lourd qu'une sonde —,
              plus rien ne le redemandait. L'analyse était terminée et payée, l'écran restait sur
              « Analyse en cours », et tous les modules disaient qu'on n'avait rien analysé.
            */
            const { report } = await fetchReport(job.reportId);
            if (cancelled) return;
            cancelled = true;
            clearInterval(timer);
            setReports((previous) => [summaryOf(report), ...previous.filter((entry) => entry.id !== report.id)]);
            setReportsKnown(true);
            setCurrentReport(report);
            if (accountId) {
              rememberActiveReport(accountId, report.id);
              rememberNewestReport(accountId, report.id);
            }
            setAnalysisJob(null);
            navigate(pathOf('analyse'));
            toast.success(`Analyse terminée pour « ${report.nicheName} »`, { id: toastId, description: undefined, duration: 6_000 });
            void refresh();
            return;
          }
          if (job.status === 'failed') {
            cancelled = true;
            clearInterval(timer);
            setAnalysisJob(null);
            toast.error('L’analyse n’a pas abouti', { id: toastId, description: job.error?.message ?? 'Erreur inconnue.', duration: 12_000 });
            void refresh();
            return;
          }
          if (job.status !== analysisJobStatus) setAnalysisJob(job);
        })
        .catch(() => {
          // Coupure passagère : l'analyse continue sur le serveur, le suivi réessaie.
          failures += 1;
          if (failures === 5) {
            toast.loading('Analyse en cours', { id: toastId, description: 'Connexion instable : l’analyse continue.' });
          }
        })
        .finally(() => {
          busy = false;
        });
      // En attente, la sonde ralentit : c'est elle qui relance, mais le rendez-vous est loin.
    }, analysisJobStatus === 'waiting' ? JOB_WAIT_POLL_MS : JOB_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accountId, analysisJobId, analysisJobStatus, analysisJobRetryAfter, analysisJobErrorCode, navigate, refresh]);

  // Export PDF : passe obligatoirement par la porte de conformité.
  const exportPdf = useCallback(async () => {
    if (!currentReport) {
      toast.info('Aucun rapport à exporter', {
        description: 'Analysez d’abord une niche : le dossier PDF reprend son rapport.',
      });
      return;
    }
    setIsExportingPdf(true);
    try {
      const verdict = await exportReportPDF(currentReport, (amount, currency) => money.format(amount, currency, { round: true }));
      if (verdict.findings.length > 0) {
        toast.info('Dossier PDF téléchargé', {
          description: `${verdict.findings.length} point(s) de vigilance signalé(s).`,
        });
      } else {
        toast.success('Dossier PDF téléchargé');
      }
    } catch (error) {
      if (error instanceof ComplianceBlockedError) {
        setBlockedVerdict(error.verdict);
        return;
      }
      toast.error("Le PDF n'a pas pu être généré", { description: 'Le document n’a pas pu être assemblé sur cet appareil.' });
    } finally {
      setIsExportingPdf(false);
    }
  }, [currentReport, money]);

  const value = useMemo<WorkspaceContextType>(
    () => ({
      reports,
      currentReport,
      isLoadingReport,
      selectReport,
      deleteReport,
      deleteAllReports,
      isAnalyzing: analysisJob !== null,
      analysisJob,
      analyzeNiche,
      cancelAnalysis,
      isExportingPdf,
      exportPdf,
      analysisDialogOpen,
      setAnalysisDialogOpen,
      commandOpen,
      setCommandOpen,
    }),
    [
      reports,
      currentReport,
      isLoadingReport,
      selectReport,
      deleteReport,
      deleteAllReports,
      analysisJob,
      analyzeNiche,
      cancelAnalysis,
      isExportingPdf,
      exportPdf,
      analysisDialogOpen,
      commandOpen,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      {/* Détail d'un export refusé par la conformité — sans échappatoire. */}
      <ComplianceBlockDialog
        verdict={blockedVerdict}
        open={blockedVerdict !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setBlockedVerdict(null);
        }}
      />
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace doit être utilisé dans un WorkspaceProvider');
  return context;
};
