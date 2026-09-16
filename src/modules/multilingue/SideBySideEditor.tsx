import { CircleAlert, TriangleAlert } from 'lucide-react';
import type { GuideSection, TranslationCheck } from '@server/shared/guides';
import { findLanguage } from '@server/shared/languages';
import { cn } from '@/shared/lib/utils';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';

/** Original à gauche, traduction modifiable à droite ; empilés sur téléphone. */

export interface TextDocument {
  title: string;
  sections: GuideSection[];
}

export function CheckList({ checks, className }: { checks: readonly TranslationCheck[]; className?: string }) {
  if (checks.length === 0) return null;
  return (
    <ul className={cn('space-y-1.5', className)}>
      {checks.map((check, index) => {
        const Icon = check.severity === 'error' ? CircleAlert : TriangleAlert;
        return (
          <li
            key={`${check.code}-${check.sectionId ?? 'guide'}-${index}`}
            className={cn('flex items-start gap-2 text-xs leading-relaxed', check.severity === 'error' ? 'text-danger' : 'text-warning')}
          >
            <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="sr-only">{check.severity === 'error' ? 'Erreur : ' : 'À vérifier : '}</span>
              {check.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const rowsFor = (text: string) => Math.min(18, Math.max(4, Math.ceil(text.length / 70) + text.split('\n').length - 1));

export function SideBySideEditor({
  sourceLanguage,
  targetLanguage,
  source,
  value,
  onChange,
  checks,
  disabled = false,
}: {
  sourceLanguage: string;
  targetLanguage: string;
  source: TextDocument;
  value: TextDocument;
  onChange: (next: TextDocument) => void;
  checks: readonly TranslationCheck[];
  disabled?: boolean;
}) {
  const from = findLanguage(sourceLanguage);
  const to = findLanguage(targetLanguage);
  const byId = new Map(value.sections.map((section) => [section.id, section]));

  const update = (id: string, patch: Partial<GuideSection>) => {
    onChange({
      ...value,
      sections: source.sections.map((original) => {
        const current = byId.get(original.id) ?? { id: original.id, heading: '', body: '' };
        return original.id === id ? { ...current, ...patch } : current;
      }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="hidden grid-cols-2 gap-4 px-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase md:grid">
        <span>Original · {from?.fr ?? sourceLanguage}</span>
        <span>Traduction · {to?.fr ?? targetLanguage}</span>
      </div>

      <div className="grid gap-3 rounded-xl border p-4 md:grid-cols-2 md:gap-4">
        <div className="min-w-0" lang={sourceLanguage} dir={from?.direction}>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Titre</p>
          <p className="font-display text-lg font-bold">{source.title}</p>
        </div>
        <div className="min-w-0">
          <label htmlFor="translation-title" className="mb-1 block text-xs font-medium text-muted-foreground">
            Titre traduit
          </label>
          <Input
            id="translation-title"
            lang={targetLanguage}
            dir={to?.direction}
            value={value.title}
            onChange={(event) => onChange({ ...value, title: event.target.value })}
            disabled={disabled}
            maxLength={200}
            className="font-semibold"
          />
        </div>
      </div>

      {source.sections.map((section, index) => {
        const current = byId.get(section.id);
        const issues = checks.filter((check) => check.sectionId === section.id);
        return (
          <section
            key={section.id}
            aria-label={`Section ${index + 1}`}
            className={cn('grid gap-3 rounded-xl border p-4 md:grid-cols-2 md:gap-4', issues.some((check) => check.severity === 'error') && 'border-danger/50')}
          >
            <div className="min-w-0 space-y-2" lang={sourceLanguage} dir={from?.direction}>
              <p className="text-xs font-medium text-muted-foreground md:hidden">Original</p>
              {section.heading && <h3 className="font-semibold">{section.heading}</h3>}
              <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{section.body}</p>
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-xs font-medium text-muted-foreground md:hidden">Traduction</p>
              {(section.heading || current?.heading) && (
                <Input
                  aria-label={`Titre de la section ${index + 1}, traduit`}
                  lang={targetLanguage}
                  dir={to?.direction}
                  value={current?.heading ?? ''}
                  onChange={(event) => update(section.id, { heading: event.target.value })}
                  disabled={disabled}
                  maxLength={300}
                  className="font-medium"
                />
              )}
              <Textarea
                aria-label={`Texte de la section ${index + 1}, traduit`}
                lang={targetLanguage}
                dir={to?.direction}
                value={current?.body ?? ''}
                onChange={(event) => update(section.id, { body: event.target.value })}
                disabled={disabled}
                maxLength={20_000}
                rows={rowsFor(current?.body ?? section.body)}
                className="leading-relaxed"
              />
              <CheckList checks={issues} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
