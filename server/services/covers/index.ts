import type { Response as ExpressResponse } from 'express';
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@server/db/client';
import { covers, guides } from '@server/db/schema';
import { env } from '@server/env';
import { AppError } from '@server/middleware';
import type { RequestAuth } from '@server/middleware/auth';
import { generateGeminiImage, geminiImagesConfigured } from '@server/services/ai/geminiImage';
import { generateImage } from '@server/services/ai/image';
import type { ImageResult } from '@server/services/ai/imageTypes';
import { coverArtDirection } from '@server/services/covers/artDirection';
import { type DesignedBook, buildDesignedCoverPrompt, designCover, reviseScene } from '@server/services/covers/design';
import { correctionNote, proofScore, proofreadCover } from '@server/services/covers/proof';
import { findOwnedGeneration, runBilledGeneration, settleGeneration } from '@server/services/generations';
import { countryName } from '@server/shared/countries';

/**
 * Couvertures des ebooks du Studio et des guides multilingues. L'image arrive dans la réponse et
 * reste en base : elle est disponible à chaque nouvel export.
 *
 * DEUX FORMES, selon l'ouvrage.
 *
 *   · Un EBOOK reçoit la couverture complète de la maison (covers/design.ts) : un livre en
 *     relief, son titre, ses points forts, son bandeau. Le maquettiste remplit la maquette d'après
 *     la fiche de l'ouvrage, le moteur d'images rend le livre, le relecteur (covers/proof.ts) lit
 *     l'image et la fait refaire une fois si un mot est faux ou ajouté — avec une scène réécrite
 *     quand c'est elle qui a fait naître le texte en trop.
 *
 *   · Un GUIDE MULTILINGUE garde une illustration sans texte : il s'exporte dans plusieurs
 *     langues, et son titre est posé par la mise en page dans celle de chaque export. La direction
 *     artistique (covers/artDirection.ts) en écrit la scène.
 *
 * L'auteur a toujours sa couverture : si la couverture complète ne peut pas être faite maintenant,
 * l'ebook reçoit une illustration, sur laquelle la mise en page pose son titre.
 */

export const COVER_STYLES = ['illustration', 'photo', 'minimal'] as const;

const STYLE_DIRECTION: Record<(typeof COVER_STYLES)[number], string> = {
  illustration: 'Modern editorial illustration, bold simple shapes, harmonious warm palette, clean composition.',
  photo: 'Editorial photograph, natural light, shallow depth of field, rich but realistic colours.',
  minimal: 'Minimalist abstract composition, soft gradients and simple geometric shapes, calm negative space.',
};


export const coverRequestSchema = z.object({
  subject: z.enum(['guide', 'product']),
  subjectId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(2).max(200),
  subtitle: z.string().trim().max(300).optional(),
  /** Ce que l'image doit montrer ; absent : une métaphore visuelle du sujet. */
  description: z.string().trim().max(500).optional(),
  style: z.enum(COVER_STYLES).default('illustration'),
  /*
    La fiche de l'ouvrage, quand l'écran la connaît : à qui il s'adresse, ce qu'il promet, ses
    chapitres. C'est d'elle que la direction artistique tire une scène qui parle de CE livre.
  */
  audience: z.string().trim().max(1000).optional(),
  promise: z.string().trim().max(1000).optional(),
  chapters: z.array(z.string().trim().max(200)).max(24).optional(),
});

export type CoverRequest = z.infer<typeof coverRequestSchema>;

/**
 * Consigne du modèle d'image. Fonction pure, testable sans appel réseau.
 *
 * Le titre n'est JAMAIS transmis, et les mots « couverture » et « livre » non plus. Donner un
 * titre à un modèle d'image revient à lui demander de l'écrire : les essais rendaient une
 * maquette de couverture complète, titre compris, en caractères inventés — « VENDRE en LiGine
 * AU CAMEROUN » — malgré la consigne « aucun texte ». On ne décrit donc qu'une scène, et la
 * mise en page pose le vrai titre ensuite, dans la langue de chaque export.
 *
 * `market` ancre la scène dans le pays du compte : sans lui, les modèles rendent par défaut des
 * décors et des visages qui ne sont pas ceux des lecteurs de Smart Creator.
 *
 * `scene` : la scène écrite par la direction artistique. Elle remplace la description et la
 * métaphore, jamais les lignes qui suivent — pays, style, tiers supérieur dégagé, aucun texte,
 * aucune marque. Ces garde-fous partent toujours, quoi qu'ait écrit le directeur artistique.
 */
export function buildCoverPrompt(
  input: Pick<CoverRequest, 'title' | 'subtitle' | 'description' | 'style'> & { market?: string | null; scene?: string | null },
): string {
  const subject = [input.title, input.subtitle].filter(Boolean).join(' — ');
  return [
    input.scene
      ? `A scene showing: ${input.scene}`
      : input.description
        ? `A scene showing: ${input.description}.`
        : `A single strong, positive visual metaphor evoking this subject, shown as a scene: ${subject}.`,
    input.market ? `Setting and people rooted in ${input.market}, everyday and contemporary.` : '',
    `Style: ${STYLE_DIRECTION[input.style]}`,
    'Vertical composition. The upper third stays calm and empty — plain background or open sky, no subject in it.',
    'A wordless illustration: no text, no letters, no numbers, no signage, no logo, no watermark, and no book-cover layout.',
    'No real brands and no celebrities; people, if any, portrayed respectfully and without stereotypes.',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 3000);
}

type CoverRow = typeof covers.$inferSelect;

/** Complète (elle porte son titre, on la montre telle quelle) ou illustration (le titre est posé dessus). */
export type CoverLayout = 'designed' | 'illustration';
const layoutOf = (value: string): CoverLayout => (value === 'designed' ? 'designed' : 'illustration');

function serializeCover(row: CoverRow) {
  return {
    id: row.id,
    subject: row.subject,
    subjectId: row.subjectId,
    status: row.status as 'pending' | 'ready' | 'failed',
    mimeType: row.mimeType,
    layout: layoutOf(row.layout),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type CoverView = ReturnType<typeof serializeCover>;

async function ownedCover(auth: RequestAuth, coverId: string | undefined): Promise<CoverRow> {
  const parsed = z.string().uuid().safeParse(coverId);
  if (!parsed.success) throw new AppError(404, 'Couverture introuvable.', 'COVER_NOT_FOUND');
  const [row] = await getDb()
    .select()
    .from(covers)
    .where(and(eq(covers.id, parsed.data), eq(covers.userId, auth.account.user.id)))
    .limit(1);
  if (!row) throw new AppError(404, 'Couverture introuvable.', 'COVER_NOT_FOUND');
  return row;
}

/** Titres des sections d'un guide, pour la direction artistique. Les « (suite) » d'un chapitre redécoupé n'en sont pas. */
async function guideHeadings(userId: string, guideId: string): Promise<string[]> {
  if (!z.string().uuid().safeParse(guideId).success) return [];
  const [row] = await getDb().select({ sections: guides.sections }).from(guides).where(and(eq(guides.userId, userId), eq(guides.id, guideId))).limit(1);
  const sections = Array.isArray(row?.sections) ? (row.sections as { heading?: unknown }[]) : [];
  return sections
    .map((section) => (typeof section.heading === 'string' ? section.heading.trim() : ''))
    .filter((heading) => heading && !/\(suite\)$/.test(heading))
    .slice(0, 12);
}

/** Temps de toute la fabrication d'une couverture complète : l'hébergeur coupe la demande à 300 s. */
const DESIGNED_BUDGET_MS = 250_000;

/** Les deux premiers moteurs de la chaîne savent écrire ; le dernier recours dessine des lettres inventées. */
const letteringModels = () => [...new Set([env.GEMINI_IMAGE_MODEL, ...env.GEMINI_IMAGE_FALLBACK_MODELS])].slice(0, 2);

/**
 * La couverture complète d'un ebook : maquette, rendu, relecture, et un second rendu si la
 * relecture trouve un défaut. `null` quand elle ne peut pas être faite maintenant (moteur
 * indisponible, rendu refusé) : l'appelant fait alors une illustration. Ne lève jamais.
 *
 * Chaque étape regarde le temps qui reste : la relecture et le second rendu sont un soin, pas
 * une condition — plutôt une couverture non relue qu'une demande coupée par l'hébergeur.
 */
async function renderDesignedCover(book: DesignedBook): Promise<{ image: ImageResult; prompt: string } | null> {
  if (!geminiImagesConfigured()) return null;
  const started = Date.now();
  const left = () => DESIGNED_BUDGET_MS - (Date.now() - started);
  const render = (prompt: string, budgetMs: number) =>
    generateGeminiImage({ prompt, aspectRatio: '2:3', imageSize: '2K', models: letteringModels(), budgetMs }).catch(() => null);

  const { design } = await designCover(book);
  const prompt = buildDesignedCoverPrompt(design, { market: book.market });
  const first = await render(prompt, Math.min(100_000, left() - 20_000));
  if (!first) return null;

  const proof = left() > 50_000 ? await proofreadCover(first, design, Math.min(40_000, left() - 10_000)) : null;
  if (!proof || proofScore(proof) === 0 || left() < 80_000) return { image: first, prompt };

  /*
    Un texte ajouté vient de la scène : tant qu'elle contient ce qui porte l'écriture (un panneau,
    une devanture, un lieu nommé), le moteur l'écrit de nouveau, même prévenu. La scène est donc
    réécrite avant le second rendu ; la note de correction, elle, vaut pour les mots mal copiés.
  */
  const revised = proof.stray.length > 0 && left() > 105_000 ? await reviseScene(design.scene, proof.stray, 20_000) : null;
  const corrected = `${revised ? buildDesignedCoverPrompt({ ...design, scene: revised }, { market: book.market }) : prompt}\n\n${correctionNote(proof)}`;
  const second = await render(corrected, Math.min(90_000, left() - 40_000));
  if (!second) return { image: first, prompt };
  const again = left() > 35_000 ? await proofreadCover(second, design, Math.min(40_000, left() - 10_000)) : null;
  // Sans seconde relecture, le second rendu est gardé : il a été fait en connaissant le défaut du premier.
  return !again || proofScore(again) <= proofScore(proof) ? { image: second, prompt: corrected } : { image: first, prompt };
}

export async function createCover(auth: RequestAuth, input: CoverRequest): Promise<CoverView> {
  const market = countryName(auth.account.user.country) || null;
  // Ce qui est enregistré avec l'image : la consigne partie, et la forme de la couverture obtenue.
  const made: { prompt: string; layout: CoverLayout } = { prompt: buildCoverPrompt({ ...input, market }), layout: 'illustration' };
  const { result } = await runBilledGeneration({
    auth,
    actionId: 'cover_generation',
    kind: 'cover',
    provider: 'cloudflare',
    run: async () => {
      const chapters = input.chapters?.length ? input.chapters : input.subject === 'guide' ? await guideHeadings(auth.account.user.id, input.subjectId).catch(() => []) : [];

      if (input.subject === 'product') {
        const complete = await renderDesignedCover({
          title: input.title,
          subtitle: input.subtitle,
          audience: input.audience,
          promise: input.promise,
          chapters,
          wish: input.description,
          market,
        });
        if (complete) {
          made.prompt = complete.prompt;
          made.layout = 'designed';
          return complete.image;
        }
      }

      const scene = await coverArtDirection({
        title: input.title,
        subtitle: input.subtitle,
        audience: input.audience,
        promise: input.promise,
        chapters,
        wish: input.description,
        market,
        medium: STYLE_DIRECTION[input.style],
      });
      if (scene) made.prompt = buildCoverPrompt({ ...input, market, scene });
      /*
        « premium » : une couverture est la première chose qu'on voit d'un produit, et ce que
        l'auteur montre pour vendre. Format portrait des exports : l'image n'y est pas déformée.
      */
      return generateImage({ prompt: made.prompt, aspectRatio: '9:16', tier: 'premium' });
    },
    describe: (image) => ({ providerRef: null, state: 'completed', fileFormat: image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1] }),
  });

  const row = await getDb().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(covers)
      .values({
        userId: auth.account.user.id,
        subject: input.subject,
        subjectId: input.subjectId,
        prompt: made.prompt,
        status: 'ready',
        mimeType: result.mimeType,
        data: result.bytes.toString('base64'),
        layout: made.layout,
      })
      .returning();
    // Une seule couverture par sujet : la précédente est remplacée.
    await tx
      .delete(covers)
      .where(and(eq(covers.userId, inserted!.userId), eq(covers.subject, inserted!.subject), eq(covers.subjectId, inserted!.subjectId), ne(covers.id, inserted!.id)));
    if (inserted!.subject === 'guide') {
      await tx.update(guides).set({ coverId: inserted!.id }).where(and(eq(guides.userId, inserted!.userId), eq(guides.id, inserted!.subjectId)));
    }
    return inserted!;
  });
  return serializeCover(row);
}

/**
 * Les couvertures prêtes d'un compte pour un type de sujet, une par sujet (la plus récente),
 * SANS leurs octets : de quoi montrer la couverture de chaque ouvrage sur sa carte en une seule
 * lecture, au lieu d'une demande par carte.
 */
export async function listCovers(auth: RequestAuth, subject: string): Promise<CoverView[]> {
  const rows = await getDb()
    .select({
      id: covers.id,
      subject: covers.subject,
      subjectId: covers.subjectId,
      status: covers.status,
      mimeType: covers.mimeType,
      layout: covers.layout,
      createdAt: covers.createdAt,
      updatedAt: covers.updatedAt,
    })
    .from(covers)
    .where(and(eq(covers.userId, auth.account.user.id), eq(covers.subject, subject), eq(covers.status, 'ready')))
    .orderBy(desc(covers.createdAt))
    .limit(300);
  const seen = new Set<string>();
  return rows
    .filter((row) => (seen.has(row.subjectId) ? false : (seen.add(row.subjectId), true)))
    .map((row) => ({ ...row, status: 'ready' as const, layout: layoutOf(row.layout), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
}

/** Dernière couverture d'un guide ou d'un produit (prête, ou en cours). */
export async function latestCover(auth: RequestAuth, subject: string, subjectId: string): Promise<CoverView | null> {
  const [row] = await getDb()
    .select()
    .from(covers)
    .where(and(eq(covers.userId, auth.account.user.id), eq(covers.subject, subject), eq(covers.subjectId, subjectId), ne(covers.status, 'failed')))
    .orderBy(desc(covers.createdAt))
    .limit(1);
  return row ? serializeCover(row) : null;
}

/**
 * État d'une couverture.
 *
 * Une couverture est désormais produite d'un seul appel et enregistrée prête. Seules les
 * couvertures lancées chez Higgsfield, fournisseur abandonné, pouvaient rester « en cours » :
 * il n'y a plus personne à interroger, et Higgsfield effaçait ses fichiers au bout de sept
 * jours. Une telle couverture est donc close en échec, et ses points rendus.
 */
export async function refreshCover(auth: RequestAuth, coverId: string | undefined): Promise<CoverView> {
  const row = await ownedCover(auth, coverId);
  if (row.status !== 'pending' || !row.providerRef) return serializeCover(row);

  const generation = await findOwnedGeneration(auth, 'higgsfield', row.providerRef).catch(() => null);
  if (generation) await settleGeneration(generation, 'failed');
  const [failed] = await getDb().update(covers).set({ status: 'failed', updatedAt: new Date() }).where(eq(covers.id, row.id)).returning();
  return serializeCover(failed!);
}

export async function sendCoverImage(auth: RequestAuth, coverId: string | undefined, res: ExpressResponse): Promise<void> {
  const row = await ownedCover(auth, coverId);
  if (row.status !== 'ready' || !row.data || !row.mimeType) {
    throw new AppError(409, 'La couverture n’est pas encore prête.', 'COVER_NOT_READY');
  }
  const bytes = Buffer.from(row.data, 'base64');
  res.setHeader('Content-Type', row.mimeType);
  // Les exports la lisent par cette route : ils doivent savoir si elle porte déjà son titre.
  res.setHeader('X-Cover-Layout', layoutOf(row.layout));
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.end(bytes);
}

export async function deleteCover(auth: RequestAuth, coverId: string | undefined): Promise<void> {
  const row = await ownedCover(auth, coverId);
  await getDb().transaction(async (tx) => {
    if (row.subject === 'guide') {
      await tx.update(guides).set({ coverId: null }).where(and(eq(guides.userId, row.userId), eq(guides.coverId, row.id)));
    }
    await tx.delete(covers).where(eq(covers.id, row.id));
  });
}

/** Supprime les couvertures d'un sujet (guide effacé). */
export async function deleteSubjectCovers(userId: string, subject: string, subjectId: string): Promise<void> {
  await getDb().delete(covers).where(and(eq(covers.userId, userId), eq(covers.subject, subject), eq(covers.subjectId, subjectId)));
}
