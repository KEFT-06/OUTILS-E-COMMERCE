import { useState } from 'react';
import { Check, Pencil, Save, Undo2, X } from 'lucide-react';
import type { StoryDraft } from '@/shared/types/storybook';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Le conte, relu et corrigé avant d'être enregistré.
 *
 * Depuis le 28/10/2026, les contes ne sont plus illustrés (génération d'images retirée du site) :
 * l'écran ne montre plus que ce que le lecteur lira — le titre et le texte de chaque page —,
 * corrigeables à la main. Enregistrer ne coûte rien : l'écriture a déjà été payée.
 */

interface StoryPreviewPanelProps {
  story: StoryDraft;
  /** Enregistre le conte tel qu'il est à l'écran, corrections comprises. */
  onSave: (story: StoryDraft) => void;
  /** Réécrit une histoire entièrement neuve, au prix de l'écriture seule. */
  onRewrite: () => void;
  busy: boolean;
}

function ChampCorrigeable({
  label,
  valeur,
  lignes,
  onChange,
}: {
  label: string;
  valeur: string;
  lignes: number;
  onChange: (valeur: string) => void;
}) {
  const [edition, setEdition] = useState<string | null>(null);

  if (edition === null) {
    return (
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <Button size="sm" variant="ghost" onClick={() => setEdition(valeur)}>
            <Pencil />
            Corriger
          </Button>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{valeur}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <Textarea value={edition} onChange={(change) => setEdition(change.target.value)} rows={lignes} aria-label={label} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            onChange(edition);
            setEdition(null);
          }}
        >
          <Check />
          Garder
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEdition(null)}>
          <X />
          Annuler
        </Button>
      </div>
    </div>
  );
}

export function StoryPreviewPanel({ story, onSave, onRewrite, busy }: StoryPreviewPanelProps) {
  /** Copie de travail : l'original reste disponible tant que rien n'est enregistré. */
  const [brouillon, setBrouillon] = useState<StoryDraft>(story);
  const modifie = JSON.stringify(brouillon) !== JSON.stringify(story);

  const majTexte = (rang: number, valeur: string) =>
    setBrouillon((actuel) => ({
      ...actuel,
      pages: actuel.pages.map((page, index) => (index === rang ? { ...page, text: valeur } : page)),
    }));

  return (
    <Card className="border-brand-green-text/40">
      <CardHeader>
        <CardTitle>Relisez votre conte</CardTitle>
        <CardDescription>Corrigez le texte si besoin, puis enregistrez-le : il rejoint « Mes contes » et se télécharge en PDF.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{brouillon.pages.length} pages</Badge>
          {modifie && <Badge variant="brand">Corrigé</Badge>}
        </div>

        <Input
          value={brouillon.title}
          onChange={(change) => setBrouillon((actuel) => ({ ...actuel, title: change.target.value }))}
          aria-label="Titre du conte"
          className="font-display text-lg font-extrabold"
        />

        <div className="space-y-4">
          {brouillon.pages.map((page, rang) => (
            <section key={rang} className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
              <h3 className="font-display font-bold">
                Page {rang + 1}
                {page.heading ? ` — ${page.heading}` : ''}
              </h3>
              <ChampCorrigeable label="Texte de la page" valeur={page.text} lignes={5} onChange={(valeur) => majTexte(rang, valeur)} />
            </section>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button onClick={() => onSave(brouillon)} disabled={busy || !brouillon.title.trim()}>
            {busy ? <Spinner /> : <Save />}
            Enregistrer le conte
          </Button>
          {modifie && (
            <Button variant="ghost" onClick={() => setBrouillon(story)} disabled={busy}>
              <Undo2 />
              Revenir au texte d’origine
            </Button>
          )}
          <Button variant="outline" onClick={onRewrite} disabled={busy}>
            Écrire une autre histoire
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
