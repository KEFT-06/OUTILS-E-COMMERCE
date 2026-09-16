import { safeHttpsUrl } from '@/shared/lib/safeUrl';
import { DigitalProductIdea } from '@/shared/types/analysis';
import { ComplianceSection } from '@/shared/types/compliance';
import { AwarenessLevel } from '@/shared/types/creatives';
import { FaqItem, ProductPageDraft, SectionRole } from '@/shared/types/productPage';

/**
 * Générateur de pages produits — feuille de route 5.3.
 *
 * Fonctions pures : modèle de page, sections soumises à la conformité et rendu
 * HTML. Aucune dépendance au navigateur, pour pouvoir être vérifiées hors écran.
 *
 * Le rendu HTML applique la leçon du défaut D8 de l'audit (interpolation non
 * échappée dans le HTML exporté) : chaque texte est échappé, chaque lien est
 * filtré, et la page embarque une politique de sécurité qui interdit tout script
 * — si un échappement venait à manquer, rien ne s'exécuterait quand même.
 */

export type PageVariant = 'A' | 'B';

export interface SectionSpec {
  role: SectionRole;
  label: string;
  purpose: string;
  /** Ce que doit montrer l'image de la section, pour le générateur de créatifs. */
  imageBrief: string;
  awarenessLevel: AwarenessLevel;
}

export const PAGE_SECTIONS: readonly SectionSpec[] = [
  {
    role: 'hero',
    label: 'Accroche',
    purpose: "Dire en une phrase ce que l'acheteur obtient.",
    imageBrief: "Le produit ou son résultat, montré dans une situation réelle d'usage.",
    awarenessLevel: 'product_aware',
  },
  {
    role: 'problem',
    label: 'Problème',
    purpose: 'Nommer la difficulté que vit le lecteur, avec ses mots.',
    imageBrief: 'La frustration vécue par la cible, reconnaissable et sans exagération.',
    awarenessLevel: 'problem_aware',
  },
  {
    role: 'solution',
    label: 'Transformation',
    purpose: 'Montrer ce qui change grâce au produit.',
    imageBrief: 'Le bénéfice obtenu, sans comparaison avant/après.',
    awarenessLevel: 'solution_aware',
  },
  {
    role: 'content',
    label: 'Contenu',
    purpose: 'Détailler ce que contient le produit, module par module.',
    imageBrief: 'Un aperçu concret du produit : pages, écrans ou supports.',
    awarenessLevel: 'product_aware',
  },
  {
    role: 'audience',
    label: 'Pour qui',
    purpose: "Aider le lecteur à se reconnaître — et à s'écarter si ce n'est pas pour lui.",
    imageBrief: 'Une personne représentative du public visé.',
    awarenessLevel: 'solution_aware',
  },
  {
    role: 'offer',
    label: 'Offre',
    purpose: 'Prix, bonus et conditions, sans ambiguïté.',
    imageBrief: 'Le produit et son bonus présentés ensemble.',
    awarenessLevel: 'most_aware',
  },
  {
    role: 'faq_cta',
    label: "Questions et appel à l'action",
    purpose: 'Lever les dernières objections, puis inviter à acheter.',
    imageBrief: "Facultative : un rappel visuel de l'offre.",
    awarenessLevel: 'most_aware',
  },
];

const DEFAULT_CTA = 'Obtenir le produit';

export function emptyPageDraft(product: DigitalProductIdea): ProductPageDraft {
  return {
    productId: product.id,
    headlineA: product.title,
    headlineB: '',
    ctaLabelA: DEFAULT_CTA,
    ctaLabelB: '',
    checkoutUrl: '',
    problem: '',
    notFor: '',
    offerConditions: '',
    price: '',
    faq: [],
    images: {},
  };
}

export function hasVariantB(draft: ProductPageDraft): boolean {
  return Boolean(draft.headlineB.trim() || draft.ctaLabelB.trim());
}

/** Ce qui manque pour exporter. Ces éléments ne peuvent pas être inventés à la place de l'auteur. */
export function missingForExport(draft: ProductPageDraft): string[] {
  const missing: string[] = [];
  if (!safeHttpsUrl(draft.checkoutUrl)) {
    missing.push('Un lien de paiement en https : sans lui, la page ne peut rien vendre.');
  }
  if (!draft.problem.trim()) {
    missing.push('La section Problème : elle décrit la difficulté de votre lecteur, et Smart Creator ne l\'invente pas.');
  }
  return missing;
}

export interface PageModel {
  variant: PageVariant;
  headline: string;
  subtitle: string;
  ctaLabel: string;
  checkoutUrl: string | null;
  problem: string;
  promise: string;
  audience: string;
  notFor: string;
  modules: { number: number; title: string; details: string }[];
  price: string;
  leadMagnet: { title: string; format: string; hook: string };
  offerConditions: string;
  faq: FaqItem[];
  /** Uniquement des liens https validés. */
  images: Partial<Record<SectionRole, string>>;
}

/** Chaîne vide quand le produit n'a pas de prix : aucun prix n'est inventé à la place de l'auteur. */
function formatPrice(product: DigitalProductIdea): string {
  if (product.recommendedPrice === null) return '';
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: product.currency }).format(
      product.recommendedPrice,
    );
  } catch {
    return `${product.recommendedPrice.toLocaleString('fr-FR')} ${product.currency}`;
  }
}

export function buildPageModel(
  product: DigitalProductIdea,
  draft: ProductPageDraft,
  variant: PageVariant,
): PageModel {
  const useB = variant === 'B';
  const images: Partial<Record<SectionRole, string>> = {};

  for (const section of PAGE_SECTIONS) {
    const url = safeHttpsUrl(draft.images[section.role]);
    if (url) images[section.role] = url;
  }

  return {
    variant,
    headline: (useB && draft.headlineB.trim()) || draft.headlineA.trim() || product.title,
    subtitle: product.subtitle,
    ctaLabel: (useB && draft.ctaLabelB.trim()) || draft.ctaLabelA.trim() || DEFAULT_CTA,
    checkoutUrl: safeHttpsUrl(draft.checkoutUrl),
    problem: draft.problem.trim(),
    promise: product.transformationPromise,
    audience: product.targetAudience,
    notFor: draft.notFor.trim(),
    modules: product.tableOfContents.map((module) => ({
      number: module.moduleNumber,
      title: module.title,
      details: module.details,
    })),
    price: draft.price?.trim() || formatPrice(product),
    leadMagnet: { ...product.leadMagnet },
    offerConditions: draft.offerConditions.trim(),
    faq: draft.faq.filter((item) => item.question.trim() && item.answer.trim()),
    images,
  };
}

/**
 * Textes soumis à la conformité. Les deux variantes sont contrôlées ensemble :
 * exporter la variante A ne doit pas laisser passer une variante B non conforme.
 */
export function pageComplianceSections(product: DigitalProductIdea, draft: ProductPageDraft): ComplianceSection[] {
  const a = buildPageModel(product, draft, 'A');
  const b = buildPageModel(product, draft, 'B');

  return [
    { label: 'Accroche (variantes A et B)', text: [a.headline, b.headline, a.subtitle, a.ctaLabel, b.ctaLabel].join('\n') },
    { label: 'Problème', text: a.problem },
    { label: 'Transformation', text: a.promise },
    { label: 'Contenu', text: a.modules.map((module) => `${module.title}\n${module.details}`).join('\n') },
    { label: 'Pour qui', text: [a.audience, a.notFor].join('\n') },
    { label: 'Offre', text: [a.price, a.leadMagnet.title, a.leadMagnet.hook, a.offerConditions].join('\n') },
    { label: 'Questions fréquentes', text: a.faq.map((item) => `${item.question}\n${item.answer}`).join('\n') },
  ].filter((section) => section.text.trim().length > 0);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphs(text: string): string {
  if (!text.trim()) return '';
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const STYLES = [
  '*{box-sizing:border-box}',
  'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#fff;line-height:1.6}',
  'main{max-width:760px;margin:0 auto;padding:0 20px}',
  'section{padding:56px 0;border-bottom:1px solid #e2e8f0}',
  '.hero{text-align:center;padding-top:72px}',
  'h1{font-size:clamp(1.9rem,5vw,2.8rem);line-height:1.15;margin:0 0 16px}',
  'h2{font-size:1.6rem;margin:0 0 16px}',
  'h3{margin:24px 0 8px}',
  '.subtitle{font-size:1.15rem;color:#475569;margin:0 0 8px}',
  'img{display:block;max-width:100%;height:auto;border-radius:16px;margin:0 auto 24px}',
  '.cta{display:inline-block;margin-top:24px;padding:16px 28px;border-radius:12px;background:#0f172a;color:#fff;font-weight:700;text-decoration:none}',
  '.modules{padding-left:20px}',
  '.modules li{margin-bottom:16px}',
  '.modules p{margin:4px 0 0;color:#475569}',
  '.price{font-size:2rem;font-weight:800;margin:0 0 12px}',
  'dt{font-weight:700;margin-top:16px}',
  'dd{margin:4px 0 0;color:#475569}',
  'footer{max-width:760px;margin:0 auto;padding:32px 20px;font-size:.8rem;color:#64748b;text-align:center}',
].join('');

/** Page HTML autonome : styles intégrés, aucun script, aucune ressource hors images https. */
export function renderPageHtml(model: PageModel, disclaimer: string): string {
  const cta = model.checkoutUrl
    ? `<a class="cta" href="${escapeHtml(model.checkoutUrl)}" rel="noopener">${escapeHtml(model.ctaLabel)}</a>`
    : '';

  const image = (role: SectionRole, alt: string) => {
    const url = model.images[role];
    return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">` : '';
  };

  const sections = [
    `<section id="accroche" data-role="hero" class="hero">${image('hero', model.headline)}<h1>${escapeHtml(model.headline)}</h1>${
      model.subtitle ? `<p class="subtitle">${escapeHtml(model.subtitle)}</p>` : ''
    }${cta}</section>`,
    `<section id="probleme" data-role="problem"><h2>Le problème</h2>${image('problem', 'Le problème')}${paragraphs(model.problem)}</section>`,
    `<section id="transformation" data-role="solution"><h2>Ce qui change</h2>${image('solution', 'La transformation')}${paragraphs(model.promise)}</section>`,
    `<section id="contenu" data-role="content"><h2>Ce que contient le produit</h2>${image('content', 'Aperçu du produit')}<ol class="modules">${model.modules
      .map(
        (module) =>
          `<li><strong>Module ${module.number} — ${escapeHtml(module.title)}</strong>${
            module.details ? `<p>${escapeHtml(module.details)}</p>` : ''
          }</li>`,
      )
      .join('')}</ol></section>`,
    `<section id="pour-qui" data-role="audience"><h2>Pour qui</h2>${image('audience', 'Public visé')}${paragraphs(model.audience)}${
      model.notFor ? `<h3>Pour qui ce n'est pas</h3>${paragraphs(model.notFor)}` : ''
    }</section>`,
    `<section id="offre" data-role="offer"><h2>L'offre</h2>${image('offer', "L'offre")}<p class="price">${escapeHtml(model.price)}</p>${
      model.leadMagnet.title
        ? `<p>Bonus : <strong>${escapeHtml(model.leadMagnet.title)}</strong>${
            model.leadMagnet.format ? ` (${escapeHtml(model.leadMagnet.format)})` : ''
          }</p>`
        : ''
    }${paragraphs(model.offerConditions)}${cta}</section>`,
    `<section id="questions" data-role="faq_cta"><h2>${model.faq.length ? 'Questions fréquentes' : 'Prêt à commencer ?'}</h2>${image('faq_cta', model.headline)}${
      model.faq.length
        ? `<dl>${model.faq.map((item) => `<dt>${escapeHtml(item.question)}</dt><dd>${escapeHtml(item.answer)}</dd>`).join('')}</dl>`
        : ''
    }${cta}</section>`,
  ];

  return [
    '<!doctype html>',
    `<html lang="fr" data-variant="${model.variant}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // Aucun script autorisé, images https uniquement : garde-fou si un échappement manquait.
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'">`,
    `<title>${escapeHtml(model.headline)}</title>`,
    `<style>${STYLES}</style>`,
    '</head>',
    '<body>',
    `<!-- Page générée par Smart Creator, variante ${model.variant} -->`,
    `<main>${sections.join('\n')}</main>`,
    `<footer><p>${escapeHtml(disclaimer)}</p></footer>`,
    '</body>',
    '</html>',
  ].join('\n');
}
