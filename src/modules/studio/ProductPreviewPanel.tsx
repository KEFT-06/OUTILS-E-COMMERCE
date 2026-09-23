import { useState } from 'react';
import { Check, Pencil, Sparkles, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCreditGate } from '@/app/providers/CreditGateProvider';
import { toApiError } from '@/shared/lib/apiError';
import { writingApi, type WritingFinding } from '@/shared/lib/writing';
import type { DigitalProductIdea } from '@/shared/types/analysis';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Spinner } from '@/shared/ui/spinner';
import { Textarea } from '@/shared/ui/textarea';

/**
 * Aperçu du produit tel qu'il sera exporté, et retouche sur place.
 *
 * Jusqu'ici, on rédigeait puis on téléchargeait sans jamais voir le résultat : la seule façon
 * de lire son propre produit était d'ouvrir le PDF. Cet écran montre le document assemblé —
 * titre, sommaire, modules — et permet de le corriger sans quitter la page.
 *
 * Deux façons de corriger, parce qu'elles ne servent pas la même chose :
 *   · à la main, pour une faute de frappe ou une phrase qu'on sait déjà écrire ;
 *   · par une consigne à l'IA (« raccourcis », « ajoute un exemple », « ton plus direct »),
 *     pour ce qu'on sait juger mais pas reformuler.
 *
 * Rien n'est enregistré tant que l'auteur ne valide pas : une retouche qui ne convient pas
 * s'annule sans avoir touché au brouillon.
 */

interface ProductPreviewPanelProps {
  product: DigitalProductIdea;
  market: string | null;
  /** Enregistre la version modifiée dans le brouillon du compte. */
  onSave: (product: DigitalProductIdea) => void;
  /** Signalements de conformité rapportés par une retouche. */
  onFindings: (findings: WritingFinding[]) => void;
}

const WORDS = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Rend un texte brut : paragraphes, et listes commençant par « - ». */
function Prose({ text }: { text: string }) {
  const blocs = text.split(/\n{2,}/).filter((bloc) => bloc.trim());
  return (
    <div className="space-y-3">
      {blocs.map((bloc, index) => {
        const lignes = bloc.split('\n');
        const estListe = lignes.every((ligne) => ligne.trim().startsWith('-'));
        if (estListe) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {lignes.map((ligne, rang) => (
                <li key={rang}>{ligne.replace(/^\s*-\s*/, '')}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="leading-relaxed">
            {bloc}
          </p>
        );
      })}
    </div>
  );
}

function ModuleBlock({
  numero,
  titre,
  texte,
  productTitle,
  market,
  onChange,
  onFindings,
}: {
  numero: number;
  titre: string;
  texte: string;
  productTitle: string;
  market: string | null;
  onChange: (texte: string) => void;
  onFindings: (findings: WritingFinding[]) => void;
}) {
  const { runWithCredits } = useCreditGate();
  const [edition, setEdition] = useState<string | null>(null);
  const [consigne, setConsigne] = useState('');
  const [enCours, setEnCours] = useState(false);
  /** Version d'avant la retouche : permet de revenir en arrière sans rien avoir perdu. */
  const [avant, setAvant] = useState<string | null>(null);

  async function retoucher() {
    const demande = consigne.trim();
    if (!demande || enCours) return;
    setEnCours(true);
    try {
      const resultat = await runWithCredits('product_revision', () =>
        writingApi.revise({ text: texte, instruction: demande, productTitle, sectionTitle: titre, market }),
      );
      if (!resultat) return;
      setAvant(texte);
      onChange(resultat.text);
      onFindings(resultat.findings);
      setConsigne('');
      toast.success('Passage réécrit', { description: 'Relisez-le : vous pouvez revenir en arrière en un clic.' });
    } catch (error) {
      toast.error('La retouche n’a pas abouti', { description: toApiError(error, 'Réessayez dans un moment.').message });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <section className="space-y-3 border-t pt-6 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold">
          {numero}. {titre}
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">{WORDS(texte)} mots</span>
      </div>

      {edition === null ? (
        <div className="text-sm">
          {texte.trim() ? <Prose text={texte} /> : <p className="text-muted-foreground italic">Ce module n’a pas encore de contenu.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <Textarea
            value={edition}
            onChange={(change) => setEdition(change.target.value)}
            rows={14}
            aria-label={`Contenu du module ${numero}`}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                setAvant(texte);
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
      )}

      {edition === null && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setEdition(texte)}>
            <Pencil />
            Modifier à la main
          </Button>
          {avant !== null && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange(avant);
                setAvant(null);
              }}
            >
              <Undo2 />
              Revenir à l’avant
            </Button>
          )}
        </div>
      )}

      {/* La consigne à l'IA : une phrase, pas un formulaire. */}
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(envoi) => {
          envoi.preventDefault();
          void retoucher();
        }}
      >
        <Input
          value={consigne}
          onChange={(change) => setConsigne(change.target.value)}
          placeholder="Demandez une retouche : « raccourcis », « ajoute un exemple », « ton plus direct »…"
          aria-label={`Consigne de retouche du module ${numero}`}
          disabled={enCours}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={enCours || consigne.trim().length < 3}>
          {enCours ? <Spinner className="size-4" /> : <Sparkles />}
          Retoucher
        </Button>
      </form>
    </section>
  );
}

export function ProductPreviewPanel({ product, market, onSave, onFindings }: ProductPreviewPanelProps) {
  /** Copie de travail : rien ne rejoint le brouillon tant que l'auteur n'a pas validé. */
  const [brouillon, setBrouillon] = useState(product.tableOfContents);
  const modifie = brouillon.some((module, index) => module.details !== product.tableOfContents[index]?.details);
  const total = brouillon.reduce((somme, module) => somme + WORDS(module.details), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aperçu du produit</CardTitle>
        <CardDescription>
          Le document tel qu’il sera exporté. Corrigez à la main, ou demandez une retouche à l’IA : rien n’est
          enregistré tant que vous ne validez pas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{brouillon.length} modules</Badge>
          <Badge variant="outline">{total.toLocaleString('fr-FR')} mots</Badge>
          {/* Une page A4 aérée fait environ 300 mots : le repère que le Studio utilise déjà. */}
          <Badge variant="outline">≈ {Math.max(1, Math.round(total / 300))} pages</Badge>
        </div>

        <article className="space-y-6 rounded-xl border bg-card p-4 sm:p-6">
          <header className="space-y-1 border-b pb-4">
            <h2 className="font-display text-2xl font-extrabold tracking-tight">{product.title}</h2>
            {product.subtitle && <p className="text-muted-foreground">{product.subtitle}</p>}
          </header>

          {brouillon.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Ce produit n’a pas encore de plan. Lancez le mode Génératif : l’IA compose la structure et la rédige.
            </p>
          ) : (
            brouillon.map((module, index) => (
              <ModuleBlock
                key={`${module.moduleNumber}-${index}`}
                numero={index + 1}
                titre={module.title}
                texte={module.details}
                productTitle={product.title}
                market={market}
                onFindings={onFindings}
                onChange={(texte) =>
                  setBrouillon((actuel) => actuel.map((entree, rang) => (rang === index ? { ...entree, details: texte } : entree)))
                }
              />
            ))
          )}
        </article>

        <div className="flex flex-wrap gap-2">
          <Button disabled={!modifie} onClick={() => onSave({ ...product, tableOfContents: brouillon })}>
            <Check />
            Enregistrer les modifications
          </Button>
          {modifie && (
            <Button variant="ghost" onClick={() => setBrouillon(product.tableOfContents)}>
              <Undo2 />
              Tout annuler
            </Button>
          )}
          {!modifie && <p className="self-center text-sm text-muted-foreground">Aucune modification en attente.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
