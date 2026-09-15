import { TriangleAlert } from 'lucide-react';
import type { WritingFinding } from '@/shared/lib/writing';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';

/** Formulations relevées par le vérificateur de conformité dans un texte que l'IA vient de rédiger. */
export function WritingFindings({ findings }: { findings: readonly WritingFinding[] }) {
  if (findings.length === 0) return null;
  const blocking = findings.some((finding) => finding.severity === 'block');

  return (
    <Alert variant={blocking ? 'danger' : 'warning'} role="status">
      <TriangleAlert />
      <AlertTitle>{blocking ? 'Formulations à corriger avant l’export' : 'Points de vigilance dans le texte rédigé'}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-4">
          {findings.slice(0, 8).map((finding, index) => (
            <li key={`${finding.label}-${index}`}>
              <span className="font-medium">{finding.label}</span>
              {finding.matched ? <> : « {finding.matched} »</> : null} — {finding.rewriteHint}
            </li>
          ))}
        </ul>
        {findings.length > 8 && <p>Et {findings.length - 8} autre(s), détaillés au moment de l’export.</p>}
      </AlertDescription>
    </Alert>
  );
}
