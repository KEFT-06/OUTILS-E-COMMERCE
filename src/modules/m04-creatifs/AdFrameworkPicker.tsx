import { Lock } from 'lucide-react';
import { AD_FRAMEWORKS, findAdFramework } from '@server/shared/adFrameworks';
import { useAuth } from '@/features/auth/AuthContext';
import { usePlans } from '@/shared/lib/plans';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Field, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';

/**
 * Choix de la méthode publicitaire d'une vidéo ou d'un visuel pub.
 *
 * Toutes les méthodes sont montrées ; celles hors du palier sont verrouillées,
 * avec le palier qui les ouvre. Le serveur refuse de toute façon une méthode
 * verrouillée.
 */
export function AdFrameworkPicker({
  value,
  onChange,
  beats,
  onBeatsChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (id: string) => void;
  beats: string[];
  onBeatsChange: (beats: string[]) => void;
  disabled?: boolean;
}) {
  const { account } = useAuth();
  const { catalog } = usePlans(account?.country);
  const limit = account ? account.limits.adFrameworks : 0;
  const isAvailable = (index: number) => limit === null || index < limit;
  const availableCount = limit === null ? AD_FRAMEWORKS.length : Math.min(limit, AD_FRAMEWORKS.length);
  const unlockedBy = (index: number) =>
    catalog?.plans.find((plan) => plan.limits.adFrameworks === null || plan.limits.adFrameworks > index)?.label;
  const selected = findAdFramework(value);

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
          Méthode publicitaire
          <Badge variant="outline" className="tabular-nums">
            {availableCount} sur {AD_FRAMEWORKS.length} avec votre palier
          </Badge>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {AD_FRAMEWORKS.map((framework, index) => {
            const available = isAvailable(index);
            const active = framework.id === value;
            const planLabel = unlockedBy(index);
            return (
              <label
                key={framework.id}
                className={cn(
                  'rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                  available ? 'cursor-pointer hover:border-primary/50' : 'cursor-not-allowed bg-muted/40',
                  active && 'border-primary bg-accent/60',
                )}
              >
                <input
                  type="radio"
                  name="ad-framework"
                  value={framework.id}
                  checked={active}
                  disabled={!available || disabled}
                  onChange={() => onChange(framework.id)}
                  className="sr-only"
                />
                <span className="flex items-center justify-between gap-2">
                  <span className={cn('text-sm font-semibold', !available && 'text-muted-foreground')}>{framework.acronym}</span>
                  {!available && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3" aria-hidden="true" />
                      {planLabel ? `Dès ${planLabel}` : 'Palier supérieur'}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{framework.expansion}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {selected && (
        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold">
              {selected.acronym} · {selected.expansion}
            </p>
            <p className="text-sm text-muted-foreground">
              {selected.summary} <span className="text-foreground">{selected.bestFor}</span>
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Écrivez le message de chaque étape. Une étape laissée vide suit la consigne de la méthode.
          </p>
          <ol className="grid gap-3 sm:grid-cols-2">
            {selected.steps.map((step, index) => (
              <li key={step.name}>
                <Field>
                  <FieldLabel htmlFor={`beat-${selected.id}-${index}`}>
                    {index + 1}. {step.label}
                  </FieldLabel>
                  <Input
                    id={`beat-${selected.id}-${index}`}
                    value={beats[index] ?? ''}
                    maxLength={200}
                    disabled={disabled}
                    placeholder={step.hint}
                    onChange={(event) => {
                      const next = selected.steps.map((_, position) => beats[position] ?? '');
                      next[index] = event.target.value;
                      onBeatsChange(next);
                    }}
                  />
                </Field>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
