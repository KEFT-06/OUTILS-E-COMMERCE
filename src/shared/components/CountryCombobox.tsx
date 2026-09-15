import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { findCountry, searchCountries } from '@server/shared/countries';
import { CountryFlag } from '@/shared/components/CountryFlag';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/shared/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';

/**
 * Choix d'un pays parmi tous les pays du monde : on tape le nom, le drapeau
 * apparaît. La recherche ignore accents et majuscules, et comprend les noms
 * courants (« RDC », « USA », « Angleterre »).
 */
export function CountryCombobox({
  id,
  value,
  onChange,
  placeholder = 'Choisissez un pays',
  showCurrency = false,
  disabled = false,
  invalid = false,
  className,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (code: string) => void;
  placeholder?: string;
  /** Affiche la devise de chaque pays dans la liste. */
  showCurrency?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = findCountry(value);
  const results = useMemo(() => searchCountries(query), [query]);

  const change = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  };

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn('w-full justify-between px-3 font-normal', !selected && 'text-muted-foreground', className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected && <CountryFlag code={selected.code} />}
            <span className="truncate">{selected ? selected.fr : placeholder}</span>
          </span>
          <ChevronsUpDown className="opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start" aria-label="Choisir un pays">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Tapez le nom du pays…" />
          <CommandList>
            <CommandEmpty>Aucun pays ne correspond à « {query} ».</CommandEmpty>
            <CommandGroup>
              {results.map((country) => (
                <CommandItem
                  key={country.code}
                  value={country.code}
                  onSelect={() => {
                    onChange(country.code);
                    change(false);
                  }}
                >
                  <CountryFlag code={country.code} />
                  <span className="min-w-0 flex-1 truncate">{country.fr}</span>
                  {showCurrency && <span className="text-xs text-muted-foreground tabular-nums">{country.currency}</span>}
                  <Check className={cn('size-4', country.code === selected?.code ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
