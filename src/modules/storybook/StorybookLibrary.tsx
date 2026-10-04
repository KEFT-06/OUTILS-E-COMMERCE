import { useEffect, useState } from 'react';
import { BookOpen, Download } from 'lucide-react';
import { countryName } from '@server/shared/countries';
import { NoDataState } from '@/shared/components/NoDataState';
import { apiRequest } from '@/shared/lib/api';
import { useCachedState } from '@/shared/lib/apiCache';
import { toApiError } from '@/shared/lib/apiError';
import { type StorybookEntry, storybookPdfPath } from '@/shared/types/storybook';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/shared/ui/accordion';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Spinner } from '@/shared/ui/spinner';

/**
 * « Mes contes » : les storybooks du compte, avec leur texte, leur lien de consultation et le
 * téléchargement du PDF (servi par le serveur, jamais par le lien secret d'export).
 */

const STATUS: Record<StorybookEntry['status'], { label: string; variant: 'success' | 'info' | 'danger' }> = {
  completed: { label: 'Prêt', variant: 'success' },
  pending: { label: 'En cours', variant: 'info' },
  failed: { label: 'Échec, points rendus', variant: 'danger' },
};

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export function StorybookLibrary({ version }: { version: number }) {
  const [entries, setEntries, keepEntries] = useCachedState<StorybookEntry[]>('/api/storybook/books');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ storybooks: StorybookEntry[] }>('/api/storybook/books')
      .then(({ storybooks }) => {
        // Retenue même si l'écran a été quitté entre-temps : elle servira à sa prochaine ouverture.
        keepEntries(storybooks);
        if (!cancelled) {
          setEntries(storybooks);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toApiError(caught, 'Vos contes n’ont pas pu être chargés.').message);
      });
    return () => {
      cancelled = true;
    };
  }, [version, setEntries, keepEntries]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="size-4 text-brand-green-text" aria-hidden="true" />
          Mes contes
        </CardTitle>
        <CardDescription>Relisez le texte de chaque page, ouvrez le conte en ligne ou téléchargez son PDF.</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : entries === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Chargement de vos contes…
          </p>
        ) : entries.length === 0 ? (
          /*
            Une phrase grise renseignait sans débloquer. Or un conte coûte quinze points, le
            tarif le plus élevé après la vidéo : c'est exactement le moment où l'auteur hésite,
            et où lui dire ce qu'il obtiendra vaut mieux que lui dire qu'il n'a rien.
          */
          <NoDataState
            icon={BookOpen}
            title="Aucun conte pour l’instant"
            reason="Le brief ci-dessus suffit à en créer un : le prénom du personnage et le thème. L’histoire est écrite page par page, puis chaque page est illustrée et mise en page — vous téléchargez le PDF."
          />
        ) : (
          <Accordion type="single" collapsible className="w-full">
            {entries.map((entry) => {
              const status = STATUS[entry.status];
              return (
                <AccordionItem key={entry.id} value={entry.id}>
                  <AccordionTrigger className="gap-3 text-left">
                    <span className="min-w-0 space-y-1">
                      <span className="block font-medium">{entry.title}</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {entry.pages} pages · {entry.language === 'fr' ? 'français' : 'anglais'} · {countryName(entry.country)} ·{' '}
                        {formatDate(entry.createdAt)}
                      </span>
                    </span>
                    <Badge variant={status.variant} className="ml-auto shrink-0">
                      {status.label}
                    </Badge>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    {entry.status === 'completed' && (
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm">
                          <a href={storybookPdfPath(entry.id)} download>
                            <Download />
                            Télécharger le PDF
                          </a>
                        </Button>
                      </div>
                    )}
                    <ol className="space-y-3">
                      {entry.story.pages.map((page, index) => (
                        <li key={`${entry.id}-${index}`} className="rounded-lg border bg-muted/30 p-3 text-sm">
                          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            Page {index + 1} · {page.heading}
                          </p>
                          <p className="mt-1 leading-relaxed">{page.text}</p>
                        </li>
                      ))}
                    </ol>
                    <p className="text-xs text-muted-foreground">Texte, mise en page et illustrations produits automatiquement.</p>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
