import { useState } from 'react';
import { Check, Pencil, Sparkles, Undo2, X } from 'lucide-react';
import type { StoryDraft } from '@/shared/types/storybook';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Le conte, lu avant d'être illustré.
 *
 * Quinze points partaient à l'aveugle : l'auteur découvrait son histoire une fois le PDF
 * produit, et une histoire qui ne lui convenait pas était déjà entièrement illustrée — c'est
 * l'étape qui coûte. Écrire vaut maintenant trois points, illustrer douze. On peut donc
 * refuser une histoire pour un cinquième du prix.
 *
 * CE QUE CET ÉCRAN MONTRE, ET POURQUOI CHAQUE PARTIE Y EST :
 *
 *  · le TEXTE de chaque page, corrigeable à la main. C'est ce que l'enfant lira ;
 *  · la SCÈNE à illustrer, également corrigeable. Elle ne paraîtra pas dans le livre, mais
 *    c'est elle qui décide de l'image — la corriger est souvent plus utile que de corriger
 *    le texte, et personne ne le devinerait si elle restait cachée ;
 *  · la FICHE DU PERSONNAGE, en tête. C'est le seul moyen dont dispose la mise en page pour
 *    garder le même visage d'une page à l'autre, et l'écran annonce déjà que cette constance
 *    n'est pas garantie. La montrer, c'est donner à l'auteur la seule prise qu'il ait dessus.
 *
 * Rien n'est renvoyé au serveur tant que l'auteur n'a pas lancé l'illustration : tant qu'il
 * relit, il ne paie rien de plus.
 */

interface StoryPreviewPanelProps {
  story: StoryDraft;
  /** Illustre le conte tel qu'il est à l'écran, corrections comprises. */
  onIllustrate: (story: StoryDraft) => void;
  /** Réécrit une histoire entièrement neuve, au prix de l'écriture seule. */
  onRewrite: () => void;
  busy: boolean;
  /** Points que coûte l'illustration, annoncés avant le geste. */
  /** Null tant que la grille tarifaire n'est pas chargée : on n'annonce aucun chiffre plutôt qu'un faux. */
  coutIllustration: number | null;
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

export function StoryPreviewPanel({ story, onIllustrate, onRewrite, busy, coutIllustration }: StoryPreviewPanelProps) {
  /** Copie de travail : l'original reste disponible tant que rien n'est illustré. */
  const [brouillon, setBrouillon] = useState<StoryDraft>(story);
  const modifie = JSON.stringify(brouillon) !== JSON.stringify(story);

  const majPage = (rang: number, champ: 'text' | 'illustration' | 'heading', valeur: string) =>
    setBrouillon((actuel) => ({
      ...actuel,
      pages: actuel.pages.map((page, index) => (index === rang ? { ...page, [champ]: valeur } : page)),
    }));

  return (
    <Card className="border-brand-green-text/40">
      <CardHeader>
        <CardTitle>Relisez avant d’illustrer</CardTitle>
        <CardDescription>
          Le texte est écrit et vous appartient déjà. L’illustration de chaque page {coutIllustration === null ? 'se facture à part' : `coûte ${coutIllustration} points`} : c’est
          l’étape à ne lancer qu’une fois l’histoire juste.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{brouillon.pages.length} pages</Badge>
          {modifie && <Badge variant="brand">Corrigé</Badge>}
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <Input
            value={brouillon.title}
            onChange={(change) => setBrouillon((actuel) => ({ ...actuel, title: change.target.value }))}
            aria-label="Titre du conte"
            className="font-display text-lg font-extrabold"
          />
          {/*
            La fiche du personnage ne paraît pas dans le livre : c'est la consigne que la mise
            en page recopie à chaque illustration pour garder le même visage. L'écran annonce
            déjà que cette constance n'est pas garantie — la montrer donne à l'auteur la seule
            prise qu'il ait dessus.
          */}
          <ChampCorrigeable
            label="Fiche du personnage — recopiée à chaque illustration"
            valeur={brouillon.characterSheet}
            lignes={3}
            onChange={(valeur) => setBrouillon((actuel) => ({ ...actuel, characterSheet: valeur }))}
          />
        </div>

        <div className="space-y-4">
          {brouillon.pages.map((page, rang) => (
            <section key={rang} className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
              <h3 className="font-display font-bold">
                Page {rang + 1}
                {page.heading ? ` — ${page.heading}` : ''}
              </h3>
              <ChampCorrigeable
                label="Texte de la page"
                valeur={page.text}
                lignes={5}
                onChange={(valeur) => majPage(rang, 'text', valeur)}
              />
              <ChampCorrigeable
                label="Scène à illustrer — ne paraît pas dans le livre"
                valeur={page.illustration}
                lignes={3}
                onChange={(valeur) => majPage(rang, 'illustration', valeur)}
              />
            </section>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button onClick={() => onIllustrate(brouillon)} disabled={busy}>
            {busy ? <Spinner /> : <Sparkles />}
            Illustrer ce conte{coutIllustration === null ? '' : ` — ${coutIllustration} points`}
          </Button>
          {modifie && (
            <Button variant="ghost" onClick={() => setBrouillon(story)} disabled={busy}>
              <Undo2 />
              Revenir au texte d’origine
            </Button>
          )}
          {/*
            Réécrire coûte le prix de l'écriture, pas celui du tout : c'est précisément ce que
            la séparation en deux étapes rend possible, et il faut que le bouton le dise.
          */}
          <Button variant="outline" onClick={onRewrite} disabled={busy}>
            Écrire une autre histoire
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
