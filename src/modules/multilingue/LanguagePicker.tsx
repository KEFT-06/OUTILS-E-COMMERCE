import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { LANGUAGES, LANGUAGE_RANKING_SOURCE, TOP_LANGUAGES, findLanguage, type Language } from '@server/shared/languages';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/shared/ui/select';

/**
 * Choix des langues : les 10 langues les plus parlées au monde d'abord, avec leur
 * rang, puis les autres. Chaque langue s'affiche aussi dans sa propre écriture.
 */

const OTHER_LANGUAGES = LANGUAGES.filter((language) => language.rank === null);

export function LanguageName({ code, className }: { code: string; className?: string }) {
  const language = findLanguage(code);
  if (!language) return <span className={className}>{code}</span>;
  return (
    <span className={className}>
      {language.fr}
      {language.native !== language.fr && (
        <span className="text-muted-foreground">
          {' · '}
          <span lang={language.code} dir={language.direction}>
            {language.native}
          </span>
        </span>
      )}
    </span>
  );
}

export function LanguageSelect({
  id,
  value,
  onChange,
  exclude = [],
}: {
  id?: string;
  value: string;
  onChange: (code: string) => void;
  exclude?: readonly string[];
}) {
  const item = (language: Language) => (
    <SelectItem key={language.code} value={language.code} disabled={exclude.includes(language.code)}>
      {language.rank !== null ? `${language.rank}. ` : ''}
      {language.fr} · {language.native}
    </SelectItem>
  );
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Choisissez une langue" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Les 10 langues les plus parlées</SelectLabel>
          {TOP_LANGUAGES.map(item)}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Autres langues</SelectLabel>
          {OTHER_LANGUAGES.map(item)}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function LanguageOption({
  language,
  selected,
  reason,
  onToggle,
}: {
  language: Language;
  selected: boolean;
  reason: string | undefined;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={Boolean(reason)}
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card',
        selected && 'border-primary bg-accent',
      )}
    >
      {language.rank !== null && (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold tabular-nums" aria-label={`Rang ${language.rank}`}>
          {language.rank}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{language.fr}</span>
        <span className="block truncate text-xs text-muted-foreground" lang={language.code} dir={language.direction}>
          {language.native}
        </span>
        {reason && <span className="block text-xs text-muted-foreground">{reason}</span>}
      </span>
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded border',
          selected && 'border-primary bg-primary text-primary-foreground',
        )}
        aria-hidden="true"
      >
        {selected && <Check className="size-3.5" />}
      </span>
    </button>
  );
}

export function LanguageMultiPicker({
  selected,
  onChange,
  unavailable,
  remaining,
}: {
  selected: string[];
  onChange: (codes: string[]) => void;
  /** Langue du guide ou déjà traduite, avec la raison affichée. */
  unavailable: Record<string, string>;
  /** Langues encore permises par le palier ; null : illimité. */
  remaining: number | null;
}) {
  const [showOthers, setShowOthers] = useState(() => selected.some((code) => findLanguage(code)?.rank === null));
  const full = remaining !== null && selected.length >= remaining;
  const reasonFor = (code: string) => unavailable[code] ?? (full && !selected.includes(code) ? 'Limite de votre palier' : undefined);
  const toggle = (code: string) => onChange(selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code]);

  const grid = (languages: readonly Language[]) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {languages.map((language) => (
        <LanguageOption
          key={language.code}
          language={language}
          selected={selected.includes(language.code)}
          reason={reasonFor(language.code)}
          onToggle={() => toggle(language.code)}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Les 10 langues les plus parlées au monde</h3>
        <p className="text-xs text-muted-foreground">{LANGUAGE_RANKING_SOURCE}</p>
      </div>
      {grid(TOP_LANGUAGES)}
      <Button type="button" variant="ghost" size="sm" onClick={() => setShowOthers((open) => !open)} aria-expanded={showOthers}>
        <ChevronDown className={cn('transition-transform', showOthers && 'rotate-180')} />
        {showOthers ? 'Masquer les autres langues' : `Autres langues (${OTHER_LANGUAGES.length})`}
      </Button>
      {showOthers && grid(OTHER_LANGUAGES)}
    </div>
  );
}
