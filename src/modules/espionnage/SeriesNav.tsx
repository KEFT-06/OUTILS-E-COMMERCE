import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

/**
 * Navigation entre les séries du mur : précédente, suivante, ou n'importe laquelle.
 *
 * Une série est une page d'annonces. On ne pouvait qu'avancer d'une série à la fois, par
 * « Actualiser » ; revenir à la deuxième demandait de faire le tour (propriétaire, 07/10/2026).
 * La barre dit aussi exactement où l'on est : « annonces 101 à 200 sur 380 ».
 */

/** Au-delà, une liste déroulante devient un annuaire : on tape le numéro de la série. */
const LISTE_MAX = 40;

export function SeriesNav({
  batch,
  batches,
  matching,
  pageSize,
  shown,
  onGo,
  disabled = false,
}: {
  /** Série affichée, à partir de 0. */
  batch: number;
  batches: number;
  /** Annonces retenues par les réglages, toutes séries confondues. */
  matching: number;
  pageSize: number;
  /** Annonces de la série affichée. */
  shown: number;
  onGo: (batch: number) => void;
  disabled?: boolean;
}) {
  const [saisie, setSaisie] = useState(String(batch + 1));
  // La série change aussi par « Précédente » et « Suivante » : le champ suit.
  useEffect(() => setSaisie(String(batch + 1)), [batch]);

  if (matching === 0) return null;
  const first = batch * pageSize + 1;
  const last = batch * pageSize + shown;
  const count = matching.toLocaleString('fr-FR');

  const allerAuNumero = () => {
    const numero = Math.round(Number(saisie));
    if (!Number.isFinite(numero)) return setSaisie(String(batch + 1));
    // Hors bornes : on va à la plus proche, sans message — 999 mène à la dernière série.
    const cible = Math.min(Math.max(numero, 1), batches);
    setSaisie(String(cible));
    if (cible - 1 !== batch) onGo(cible - 1);
  };

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2" aria-label="Séries d’annonces">
      <p className="text-sm tabular-nums text-muted-foreground">
        {batches > 1 ? (
          <>
            Annonces <span className="font-semibold text-foreground">{first.toLocaleString('fr-FR')}</span> à{' '}
            <span className="font-semibold text-foreground">{last.toLocaleString('fr-FR')}</span> sur{' '}
            <span className="font-semibold text-foreground">{count}</span>
          </>
        ) : (
          <>
            <span className="font-semibold text-foreground">{count}</span> annonce{matching > 1 ? 's' : ''}, toutes affichées
          </>
        )}
      </p>
      {batches > 1 && (
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => onGo(batch - 1)} disabled={disabled || batch === 0}>
            <ChevronLeft />
            <span className="hidden sm:inline">Précédente</span>
          </Button>
          {batches <= LISTE_MAX ? (
            <Select value={String(batch)} onValueChange={(value) => onGo(Number(value))} disabled={disabled}>
              <SelectTrigger size="sm" className="w-[9.5rem] tabular-nums" aria-label="Aller à une série">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {Array.from({ length: batches }, (_, index) => (
                  <SelectItem key={index} value={String(index)}>
                    Série {index + 1} sur {batches}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <form
              className="flex items-center gap-1.5 text-sm tabular-nums"
              onSubmit={(submit) => {
                submit.preventDefault();
                allerAuNumero();
              }}
            >
              <span className="text-muted-foreground">Série</span>
              <Input
                value={saisie}
                onChange={(change) => setSaisie(change.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                onBlur={allerAuNumero}
                inputMode="numeric"
                enterKeyHint="go"
                className="h-8 w-16 text-center"
                aria-label={`Aller à une série, de 1 à ${batches}`}
                disabled={disabled}
              />
              <span className="text-muted-foreground">sur {batches.toLocaleString('fr-FR')}</span>
            </form>
          )}
          <Button variant="outline" size="sm" onClick={() => onGo(batch + 1)} disabled={disabled || batch >= batches - 1}>
            <span className="hidden sm:inline">Suivante</span>
            <ChevronRight />
          </Button>
        </div>
      )}
    </nav>
  );
}
