import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { fr } from 'react-day-picker/locale';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Calendar } from '@/shared/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';

/** « 2026-10-26 » ⇄ date locale à midi : à minuit, un fuseau en retard ferait reculer d'un jour. */
const fromIso = (iso: string) => new Date(`${iso}T12:00:00`);
const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * Choix d'une date, en français quel que soit le navigateur.
 *
 * Le champ de date natif s'affiche dans la langue du navigateur : « 10/26/2026 » sur un navigateur
 * en anglais, pour un écran entièrement en français. La valeur reste une date ISO (« 2026-10-26 »).
 */
export function DatePicker({
  id,
  value,
  onChange,
  max,
  className,
}: {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  /** Dernière date permise, ISO. */
  max?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? fromIso(value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" className={cn('w-full justify-between font-normal', !selected && 'text-muted-foreground', className)}>
          {selected ? selected.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Choisir une date'}
          <CalendarDays aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={fr}
          selected={selected}
          defaultMonth={selected}
          disabled={max ? { after: fromIso(max) } : undefined}
          onSelect={(date) => {
            if (!date) return;
            onChange(toIso(date));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
