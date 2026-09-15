import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { MarketAnalysisReport } from '@/shared/types/analysis';
import type { ReportComplianceVerdict } from '@/shared/types/compliance';
import { ComplianceBlockedError, exportReportPDF } from '@/shared/lib/complianceGate';
import { ComplianceBlockDialog } from '@/shared/ui/ComplianceBlockDialog';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { pathOf } from '@/app/navigation';

/**
 * État de l'espace de travail partagé par tous les écrans : rapports analysés (aucun
 * rapport d'exemple : l'espace démarre vide),
 * niche active, analyse et export PDF, fenêtres ouvertes depuis l'en-tête ou la
 * palette ⌘K.
 */
interface WorkspaceContextType {
  reports: MarketAnalysisReport[];
  currentReport: MarketAnalysisReport | null;
  selectReport: (id: string) => void;
  isAnalyzing: boolean;
  analyzeNiche: (query: string) => Promise<void>;
  isExportingPdf: boolean;
  exportPdf: () => Promise<void>;
  analysisDialogOpen: boolean;
  setAnalysisDialogOpen: (open: boolean) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const { runWithCredits } = useCreditGate();

  const [reports, setReports] = useState<MarketAnalysisReport[]>([]);
  const [currentReport, setCurrentReport] = useState<MarketAnalysisReport | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [blockedVerdict, setBlockedVerdict] = useState<ReportComplianceVerdict | null>(null);

  const selectReport = useCallback(
    (id: string) => {
      const found = reports.find((report) => report.id === id);
      if (found) setCurrentReport(found);
    },
    [reports],
  );

  /**
   * Analyse d'une nouvelle niche, derrière la porte de crédits : le coût
   * s'affiche avant l'appel et les points ne sont débités qu'en cas de succès.
   * Aucun rapport de repli n'est fabriqué : l'erreur du serveur est montrée telle
   * quelle, elle dit ce qui manque (clé absente, analyse pas encore livrée).
   */
  const analyzeNiche = useCallback(
    async (query: string) => {
      try {
        await runWithCredits('niche_analysis', async () => {
          setIsAnalyzing(true);
          try {
            const response = await fetch('/api/analyze-niche', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query }),
            });

            if (!response.ok) {
              const payload = (await response.json().catch(() => null)) as
                | { error?: { message?: string } }
                | null;
              throw new Error(payload?.error?.message ?? "L'analyse n'a pas pu être lancée. Réessayez dans un moment.");
            }

            const data = (await response.json()) as MarketAnalysisReport;
            setReports((previous) => [data, ...previous]);
            setCurrentReport(data);
            navigate(pathOf('analyse'));
            toast.success(`Analyse terminée pour « ${data.nicheName} »`);
          } finally {
            setIsAnalyzing(false);
          }
        });
      } catch (error) {
        toast.error("L'analyse n'a pas abouti", {
          description: error instanceof Error ? error.message : 'Erreur inconnue.',
        });
      }
    },
    [navigate, runWithCredits],
  );

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
      selectReport,
      isAnalyzing,
      analyzeNiche,
      isExportingPdf,
      exportPdf,
      analysisDialogOpen,
      setAnalysisDialogOpen,
      commandOpen,
      setCommandOpen,
    }),
    [reports, currentReport, selectReport, isAnalyzing, analyzeNiche, isExportingPdf, exportPdf, analysisDialogOpen, commandOpen],
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
