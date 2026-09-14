import { useState } from 'react';
import { AlertTriangle, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { DigitalProductIdea } from '@/shared/types/analysis';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Mode Expert du Studio : l'utilisateur rédige lui-même la structure du produit.
 * Ce mode ne dépend d'aucun fournisseur d'IA.
 *
 * Le parent remonte ce composant quand le produit ou l'existence d'un brouillon
 * change (`key`) : le formulaire repart toujours de la version affichée.
 */
interface ProductExpertEditorProps {
  /** Version affichée : le brouillon s'il existe, sinon l'original du rapport. */
  product: DigitalProductIdea;
  hasDraft: boolean;
  writeFailed: boolean;
  onSave: (product: DigitalProductIdea) => void;
  onDiscard: () => void;
}

type ModuleItem = DigitalProductIdea['tableOfContents'][number];

export function ProductExpertEditor({ product, hasDraft, writeFailed, onSave, onDiscard }: ProductExpertEditorProps) {
  const [form, setForm] = useState<DigitalProductIdea>(product);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  const isDirty = JSON.stringify(form) !== JSON.stringify(product);
  const titleMissing = form.title.trim().length === 0;

  const update = <K extends keyof DigitalProductIdea>(key: K, value: DigitalProductIdea[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const updateModule = (index: number, changes: Partial<ModuleItem>) =>
    setForm((previous) => ({
      ...previous,
      tableOfContents: previous.tableOfContents.map((module, i) => (i === index ? { ...module, ...changes } : module)),
    }));

  const addModule = () =>
    setForm((previous) => ({
      ...previous,
      tableOfContents: [
        ...previous.tableOfContents,
        {
          moduleNumber: previous.tableOfContents.reduce((max, module) => Math.max(max, module.moduleNumber), 0) + 1,
          title: '',
          details: '',
        },
      ],
    }));

  const removeModule = (index: number) =>
    setForm((previous) => ({
      ...previous,
      tableOfContents: previous.tableOfContents.filter((_module, i) => i !== index),
    }));

  const updateLeadMagnet = (changes: Partial<DigitalProductIdea['leadMagnet']>) =>
    setForm((previous) => ({ ...previous, leadMagnet: { ...previous.leadMagnet, ...changes } }));

  return (
    <div className="space-y-5 rounded-xl border border-primary/25 bg-accent/30 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Vos retouches sont enregistrées comme un brouillon, à côté de la version du rapport. Les exports utilisent la
          version affichée.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          {hasDraft && (
            <Button variant="outline" size="sm" onClick={() => setConfirmDiscardOpen(true)}>
              <RotateCcw />
              Version du rapport
            </Button>
          )}
          <Button size="sm" onClick={() => onSave(form)} disabled={!isDirty || titleMissing}>
            <Save />
            Enregistrer le brouillon
          </Button>
        </div>
      </div>

      {writeFailed && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertDescription>
            Ce navigateur refuse l’enregistrement : le brouillon sera perdu à la fermeture de l’onglet. Exportez le produit
            avant de quitter.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={titleMissing} className="sm:col-span-2">
          <FieldLabel htmlFor="expert-title">Titre</FieldLabel>
          <Input
            id="expert-title"
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
            maxLength={200}
            aria-invalid={titleMissing}
          />
          {titleMissing && <FieldError>Le titre est obligatoire.</FieldError>}
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="expert-subtitle">Sous-titre</FieldLabel>
          <Input
            id="expert-subtitle"
            value={form.subtitle}
            onChange={(event) => update('subtitle', event.target.value)}
            maxLength={300}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="expert-audience">Public cible</FieldLabel>
          <Textarea
            id="expert-audience"
            value={form.targetAudience}
            onChange={(event) => update('targetAudience', event.target.value)}
            rows={3}
            maxLength={1000}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="expert-promise">Promesse de transformation</FieldLabel>
          <Textarea
            id="expert-promise"
            value={form.transformationPromise}
            onChange={(event) => update('transformationPromise', event.target.value)}
            rows={3}
            maxLength={1000}
          />
        </Field>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Modules ({form.tableOfContents.length})</p>
          <Button variant="outline" size="sm" onClick={addModule}>
            <Plus />
            Ajouter un module
          </Button>
        </div>

        {form.tableOfContents.map((module, index) => (
          <div key={index} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-2 rounded-lg border bg-card p-3">
            <Input
              type="number"
              min={1}
              value={module.moduleNumber}
              onChange={(event) => updateModule(index, { moduleNumber: Math.max(1, Number(event.target.value) || 1) })}
              aria-label={`Numéro du module ${index + 1}`}
            />
            <div className="space-y-2">
              <Input
                value={module.title}
                onChange={(event) => updateModule(index, { title: event.target.value })}
                maxLength={200}
                placeholder="Titre du module"
                aria-label={`Titre du module ${index + 1}`}
              />
              <Textarea
                value={module.details}
                onChange={(event) => updateModule(index, { details: event.target.value })}
                rows={2}
                maxLength={4000}
                placeholder="Contenu du module"
                aria-label={`Contenu du module ${index + 1}`}
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => removeModule(index)}
              aria-label={`Supprimer le module ${index + 1}`}
              title="Supprimer le module"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="expert-lead-title">Aimant à prospects : titre</FieldLabel>
          <Input
            id="expert-lead-title"
            value={form.leadMagnet.title}
            onChange={(event) => updateLeadMagnet({ title: event.target.value })}
            maxLength={200}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="expert-lead-format">Format</FieldLabel>
          <Input
            id="expert-lead-format"
            value={form.leadMagnet.format}
            onChange={(event) => updateLeadMagnet({ format: event.target.value })}
            maxLength={100}
          />
        </Field>
        <Field className="sm:col-span-3">
          <FieldLabel htmlFor="expert-lead-hook">Accroche</FieldLabel>
          <Textarea
            id="expert-lead-hook"
            value={form.leadMagnet.hook}
            onChange={(event) => updateLeadMagnet({ hook: event.target.value })}
            rows={2}
            maxLength={1000}
          />
        </Field>
      </div>

      <Dialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Abandonner vos retouches ?</DialogTitle>
            <DialogDescription>
              Le brouillon sera supprimé et le produit reviendra à la version issue du rapport.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Garder mes retouches</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDiscardOpen(false);
                onDiscard();
              }}
            >
              Revenir à la version du rapport
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
