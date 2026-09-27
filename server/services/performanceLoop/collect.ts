import { and, desc, eq, gte } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { performanceContributions, reports, userIntegrations, users } from '@server/db/schema';
import { decryptSecret } from '@server/lib/crypto';
import { getMarketplace } from '@server/services/marketplaces';
import { aggregateBenchmarks, MIN_SELLERS_PER_GROUP, type PerformanceContribution } from '@server/services/performanceLoop';

/**
 * Collecte et lecture du repère partagé de performance.
 *
 * Ce que le repère répond, et que rien d'autre ne sait dire au vendeur : « vos produits se
 * vendent douze fois par mois ; la médiane des vendeurs de votre niche est à trente-quatre ».
 * Le radar mesure les concurrents, l'analyse mesure le marché ; ici seulement, le vendeur se
 * situe lui-même.
 *
 * TROIS RÈGLES QUI NE SE NÉGOCIENT PAS, et qui viennent du module d'agrégation :
 *
 *  1. Participation explicite. Verser ses chiffres de vente dans un calcul commun se demande,
 *     cela ne se suppose pas ; le consentement est relu À CHAQUE LECTURE, si bien qu'un retrait
 *     prend effet tout de suite, sans attendre une purge.
 *  2. Un vendeur pèse pour un, quel que soit son nombre de relevés.
 *  3. Rien n'est publié en dessous de cinq vendeurs. Dans une niche étroite, une médiane
 *     calculée sur deux vendeurs les désigne.
 *
 * CONSÉQUENCE ASSUMÉE : tant que cinq vendeurs d'une même niche et d'un même marché n'ont pas
 * accepté, le repère ne montre rien. C'est la raison d'accumuler dès maintenant plutôt qu'au
 * moment où il deviendra lisible — un repère qui commence sa collecte le jour où on le lit
 * n'a aucune profondeur, et c'est justement la profondeur qu'on vend.
 *
 * Ce que le vendeur voit entre-temps n'est pas une page vide : ses propres chiffres, et le
 * nombre de participants qui manquent encore.
 */

/** Mesures sans devise : elles se comparent entre vendeurs sans conversion ni hypothèse. */
export interface SellerFigures {
  /** Ventes abouties sur les trente derniers jours. */
  salesPerMonth: number;
  /** Produits en vente au catalogue. */
  products: number;
  /** Ventes du mois rapportées au catalogue : un catalogue plus large n'avantage personne. */
  salesPerProduct: number;
}

const JOUR_MS = 86_400_000;

/** Jour du relevé, en date seule : un vendeur ne pèse qu'une fois par jour. */
export const dayKey = (moment: Date): string => moment.toISOString().slice(0, 10);

/**
 * Chiffres d'un vendeur, lus chez sa place de marché. `null` : pas de clé branchée, ou la
 * boutique n'a pas répondu — dans les deux cas il n'y a rien à verser, et rien à inventer.
 */
export async function readSellerFigures(userId: string, now = new Date()): Promise<SellerFigures | null> {
  /*
    La clé du vendeur, et elle seule.

    `resolveChariowCredentials` retombe sur la clé d'administration quand le compte est
    administrateur — commode pour consulter, inacceptable ici : la boutique du propriétaire
    entrerait dans le repère sous le nom d'un vendeur, et pèserait sur la médiane d'une niche
    qu'elle n'occupe pas.
  */
  const [integration] = await getDb()
    .select({ secret: userIntegrations.secret })
    .from(userIntegrations)
    .where(and(eq(userIntegrations.userId, userId), eq(userIntegrations.provider, 'chariow')))
    .limit(1);
  if (!integration) return null;

  const context = { chariowApiKey: decryptSecret(integration.secret) };
  const adapter = getMarketplace('chariow');

  try {
    const [catalogue, ventes] = await Promise.all([
      adapter.listProducts(context),
      adapter.salesSummary(context, { from: dayKey(new Date(now.getTime() - 30 * JOUR_MS)), to: dayKey(now) }),
    ]);

    const products = catalogue.products.length;
    const salesPerMonth = ventes.completedSales;
    return {
      salesPerMonth,
      products,
      // Un catalogue vide ne rend pas la cadence infinie : sans produit, il n'y a pas de ratio.
      salesPerProduct: products > 0 ? Math.round((salesPerMonth / products) * 100) / 100 : 0,
    };
  } catch {
    // Une boutique injoignable n'est pas une contribution de zéro : ce serait fausser la médiane.
    return null;
  }
}

/**
 * Niche et marché du vendeur : ceux de sa dernière analyse.
 *
 * C'est le seul rattachement qui ne se devine pas. Un vendeur qui n'a jamais analysé de niche
 * n'appartient à aucun groupe, et ses chiffres ne sont pas versés — les comparer à ceux d'une
 * niche qu'il n'a pas choisie ne dirait rien de juste.
 */
export async function sellerGroup(userId: string): Promise<{ niche: string; market: string } | null> {
  const [dernier] = await getDb()
    .select({ niche: reports.nicheName, market: reports.market })
    .from(reports)
    .where(eq(reports.userId, userId))
    .orderBy(desc(reports.createdAt))
    .limit(1);
  if (!dernier?.niche || !dernier.market) return null;
  return { niche: dernier.niche, market: dernier.market };
}

/**
 * Relève les vendeurs consentants et enregistre un point par jour.
 *
 * Appelée par le planificateur, jamais par un utilisateur : elle interroge des boutiques
 * tierces, et son rythme ne doit dépendre de personne.
 */
export async function collectPerformanceContributions(now = new Date()): Promise<{ eligible: number; collected: number }> {
  const consentants = await getDb().select({ id: users.id }).from(users).where(eq(users.performanceOptIn, true));
  const day = dayKey(now);
  let collected = 0;

  for (const vendeur of consentants) {
    const groupe = await sellerGroup(vendeur.id);
    if (!groupe) continue;
    const chiffres = await readSellerFigures(vendeur.id, now);
    if (!chiffres) continue;

    await getDb()
      .insert(performanceContributions)
      .values({ userId: vendeur.id, niche: groupe.niche, market: groupe.market, metrics: { ...chiffres }, day })
      // Deux passages le même jour ne comptent pas deux fois : le second corrige le premier.
      .onConflictDoUpdate({
        target: [performanceContributions.userId, performanceContributions.day],
        set: { niche: groupe.niche, market: groupe.market, metrics: { ...chiffres } },
      });
    collected += 1;
  }

  return { eligible: consentants.length, collected };
}

/** Fenêtre de comparaison : au-delà, un chiffre décrit un marché qui n'existe plus. */
const FENETRE_JOURS = 90;

export interface PerformanceView {
  optedIn: boolean;
  /** Groupe du vendeur ; null : aucune analyse, donc aucun groupe de comparaison. */
  group: { niche: string; market: string } | null;
  /** Derniers chiffres du vendeur lui-même. Visibles même sans repère publiable. */
  own: SellerFigures | null;
  /** Médianes du groupe ; null tant que les cinq vendeurs ne sont pas réunis. */
  medians: Record<string, number> | null;
  /** Vendeurs du groupe ayant contribué sur la fenêtre. */
  sellers: number;
  /** Participants qu'il manque encore pour que le repère s'affiche. */
  sellersNeeded: number;
  minSellers: number;
}

/**
 * Repère du vendeur, et ses propres chiffres.
 *
 * Le consentement est relu ici, sur la table des comptes, et appliqué à toutes les lignes du
 * vendeur : un retrait vide sa participation immédiatement, même si ses relevés n'ont pas
 * encore été effacés.
 */
export async function performanceFor(userId: string, now = new Date()): Promise<PerformanceView> {
  const [compte] = await getDb().select({ optedIn: users.performanceOptIn }).from(users).where(eq(users.id, userId)).limit(1);
  const optedIn = compte?.optedIn ?? false;
  const group = await sellerGroup(userId);

  const [dernier] = await getDb()
    .select({ metrics: performanceContributions.metrics })
    .from(performanceContributions)
    .where(eq(performanceContributions.userId, userId))
    .orderBy(desc(performanceContributions.day))
    .limit(1);
  const own = (dernier?.metrics as unknown as SellerFigures | undefined) ?? null;

  const vide: PerformanceView = {
    optedIn,
    group,
    own,
    medians: null,
    sellers: 0,
    sellersNeeded: MIN_SELLERS_PER_GROUP,
    minSellers: MIN_SELLERS_PER_GROUP,
  };
  if (!group) return vide;

  const depuis = dayKey(new Date(now.getTime() - FENETRE_JOURS * JOUR_MS));
  const lignes = await getDb()
    .select({
      userId: performanceContributions.userId,
      niche: performanceContributions.niche,
      market: performanceContributions.market,
      metrics: performanceContributions.metrics,
      optedIn: users.performanceOptIn,
    })
    .from(performanceContributions)
    .innerJoin(users, eq(users.id, performanceContributions.userId))
    .where(
      and(
        eq(performanceContributions.niche, group.niche),
        eq(performanceContributions.market, group.market),
        gte(performanceContributions.day, depuis),
      ),
    );

  const contributions: PerformanceContribution[] = lignes.map((ligne) => ({
    sellerId: ligne.userId,
    optedIn: ligne.optedIn,
    niche: ligne.niche,
    market: ligne.market,
    metrics: ligne.metrics,
  }));

  const participants = new Set(contributions.filter((contribution) => contribution.optedIn).map((c) => c.sellerId)).size;
  const { groups } = aggregateBenchmarks(contributions);
  const publie = groups[0] ?? null;

  return {
    ...vide,
    sellers: participants,
    sellersNeeded: Math.max(0, MIN_SELLERS_PER_GROUP - participants),
    medians: publie?.medians ?? null,
  };
}

/**
 * Coupe la participation et EFFACE les relevés déjà versés.
 *
 * Le module d'agrégation écarterait déjà ce vendeur sur le seul drapeau ; les effacer
 * quand même est le sens ordinaire d'un retrait — on ne garde pas des chiffres d'affaires
 * que leur propriétaire a repris.
 */
export async function setPerformanceOptIn(userId: string, enabled: boolean): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.update(users).set({ performanceOptIn: enabled }).where(eq(users.id, userId));
    if (!enabled) await tx.delete(performanceContributions).where(eq(performanceContributions.userId, userId));
  });
}
