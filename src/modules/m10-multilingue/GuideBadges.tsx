import { useState } from 'react';
import { toast } from 'sonner';
import { Download, FileDown, FileText, Globe } from 'lucide-react';
import { REVIEW_LEVELS, type ReviewLevel, type TranslationStatus } from '@server/shared/guides';
import { type Guide } from '@/modules/m10-multilingue/guidesApi';
import { downloadGuideDocx, downloadGuideHtml, guideDocumentOf, guidePrintPath } from '@/modules/m10-multilingue/guideExport';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu';
import { Spinner } from '@/shared/ui/spinner';

export function LevelBadge({ level, compact = false }: { level: ReviewLevel; compact?: boolean }) {
  const info = REVIEW_LEVELS[level];
  return (
    <Badge variant={level === 'A' ? 'success' : level === 'B' ? 'info' : 'secondary'} title={info.description}>
      {compact ? info.name : `${info.name} · ${info.short}`}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: TranslationStatus }) {
  if (status === 'review_requested') return <Badge variant="warning">Relecture demandée</Badge>;
  if (status === 'in_review') return <Badge variant="info">En relecture</Badge>;
  return null;
}

/** Exports d'une version du guide : PDF par l'impression, Word, page HTML. */
export function ExportMenu({ guide, language }: { guide: Guide; language: string }) {
  const [busy, setBusy] = useState(false);
  const printable = guideDocumentOf(guide, language);

  const download = async (format: 'docx' | 'html') => {
    if (!printable) return;
    setBusy(true);
    try {
      if (format === 'docx') await downloadGuideDocx(printable);
      else await downloadGuideHtml(printable);
    } catch (error) {
      toast.error('L’export a échoué', { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={!printable || busy}>
          {busy ? <Spinner /> : <Download />}
          Exporter
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => window.open(guidePrintPath(guide.id, language), '_blank', 'noopener')}>
          <FileDown />
          PDF, avec la couverture
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void download('docx')}>
          <FileText />
          Word (.docx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void download('html')}>
          <Globe />
          Page HTML
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
