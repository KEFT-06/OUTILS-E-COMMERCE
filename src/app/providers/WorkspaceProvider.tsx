import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { pathOf } from '@/app/navigation';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { apiRequest } from '@/shared/lib/api';
import { toApiError } from '@/shared/lib/apiError';
import { ComplianceBlockedError, exportReportPDF } from '@/shared/lib/complianceGate';
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
  isAnalyzing: boolean;
  /** Analyse en cours du compte (étude puis rédaction), suivie jusqu'à son terme. */
  analysisJob: AnalysisJob | null;
  analyzeNiche: (query: string, market?: string | null) => Promise<void>;
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

const summaryOf = (report: MarketAnalysisReport): ReportSummary => ({
  id: report.id,
  query: report.query,
  nicheName: report.nicheName,
  market: report.market ?? null,
  createdAt: report.generator?.generatedAt ?? new Date().toISOString(),
});

const fetchReport = (id: string) => apiRequest<{ report: MarketAnalysisReport }>(`/api/reports/${encodeURIComponent(id)}`);

/** Cadence du suivi d'une analyse : l'étude dure une à plusieurs minutes. */
const JOB_POLL_MS = 3_000;

const JOB_STEPS: Record<AnalysisJob['status'], string> = {
  queued: 'Préparation de l’analyse…',
  research: 'Étude de marché sur le web en cours : comptez 1 à 3 minutes.',
  writing: 'Rédaction du rapport à partir des sources trouvées…',
  completed: 'Rapport prêt.',
  failed: 'L’analyse n’a pas abouti.',
};

export const analysisStepLabel = (status: AnalysisJob['status']) => JOB_STEPS[status];

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const { runWithCredits } = useCreditGate();
  const { account, refresh } = useAuth();
  const accountId = account?.id;

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [currentReport, setCurrentReport] = useState<MarketAnalysisReport | null>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(true);
  const [analysisJob, setAnalysisJob] = useState<AnalysisJob | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [blockedVerdict, setBlockedVerdict] = useState<ReportComplianceVerdict | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setIsLoadingReport(true);
    (async () => {
      const { reports: list } = await apiRequest<{ reports: ReportSummary[] }>('/api/reports');
      if (cancelled) return;
      setReports(list);
      const remembered = rememberedActiveReport(accountId);
      const target = list.find((entry) => entry.id === remembered) ?? list[0];
      if (!target) return;
      const { report } = await fetchReport(target.id);
      if (!cancelled) setCurrentReport(report);
    })()
      .catch((error: unknown) => {
        if (!cancelled) toast.error('Vos rapports n’ont pas pu être chargés', { description: toApiError(error, 'Réessayez dans un moment.').message });
      })
      .finally(() => {
        if (!cancelled) setIsLoadingReport(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

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
      setIsLoadingReport(true);
      try {
        const { report } = await fetchReport(id);
        setCurrentReport(report);
        if (accountId) rememberActiveReport(accountId, report.id);
      } catch (error) {
        toast.error('Le rapport n’a pas pu être ouvert', { description: toApiError(error, 'Réessayez dans un moment.').message });
      } finally {
        setIsLoadingReport(false);
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
        toast.error('Le rapport n’a pas pu être supprimé', { description: toApiError(error, 'Réessayez dans un moment.').message });
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

  // Suivi de l'analyse en cours, étape par étape, jusqu'au rapport.
  const analysisJobId = analysisJob?.id;
  const analysisJobStatus = analysisJob?.status;
  useEffect(() => {
    if (!analysisJobId || analysisJobStatus === 'completed' || analysisJobStatus === 'failed') return;
    const toastId = `analyse-${analysisJobId}`;
    toast.loading('Analyse en cours', { id: toastId, description: JOB_STEPS[analysisJobStatus ?? 'queued'], duration: Infinity });

    let cancelled = false;
    let failures = 0;
    const timer = setInterval(() => {
      apiRequest<{ job: AnalysisJob }>(`/api/analyze-niche/jobs/${encodeURIComponent(analysisJobId)}`)
        .then(async ({ job }) => {
          if (cancelled) return;
          failures = 0;
          if (job.status === 'completed' && job.reportId) {
            cancelled = true;
            clearInterval(timer);
            const { report } = await fetchReport(job.reportId);
            setReports((previous) => [summaryOf(report), ...previous.filter((entry) => entry.id !== report.id)]);
            setCurrentReport(report);
            if (accountId) rememberActiveReport(accountId, report.id);
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
            toast.loading('Analyse en cours', { id: toastId, description: 'Connexion instable : le suivi réessaie, l’analyse continue sur le serveur.' });
          }
        });
    }, JOB_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accountId, analysisJobId, analysisJobStatus, navigate, refresh]);

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
      const verdict = await exportReportPDF(currentReport);
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
      toast.error("Le PDF n'a pas pu être généré", { description: 'Réessayez dans un moment.' });
    } finally {
      setIsExportingPdf(false);
    }
  }, [currentReport]);

  const value = useMemo<WorkspaceContextType>(
    () => ({
      reports,
      currentReport,
      isLoadingReport,
      selectReport,
      deleteReport,
      isAnalyzing: analysisJob !== null,
      analysisJob,
      analyzeNiche,
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
      analysisJob,
      analyzeNiche,
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
