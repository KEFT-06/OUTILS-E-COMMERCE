import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  campaignNumbersOf,
  completeKitDraft,
  followableCompetitorOf,
  launchKitDefaultsOf,
  productPageDefaultsOf,
  scriptFor,
  spyKeywordOf,
  storybookBriefOf,
} from '@/shared/lib/analysisDefaults';
import { limitWords } from '@/shared/lib/text';
import type { DigitalProductIdea, MarketAnalysisReport, MetaAdCampaign } from '@/shared/types/analysis';
import type { CtaPlatform, ScriptFormat } from '@/shared/types/launchKit';

/**
 * Ce que l'analyse d'une niche propose dans chaque module (demande du propriétaire, 11/10/2026 :
 * « l'outil remplit toutes les cases, l'utilisateur ne fait que modifier »).
 *
 * Deux choses sont verrouillées : chaque proposition vient bien de l'analyse ou de l'ouvrage, et
 * ce que l'analyse ne sait pas — un lien de paiement, un fait culturel, une boutique que le radar
 * ne sait pas suivre — n'est jamais inventé.
 */

const scene = (sceneNumber: number, phase: MetaAdCampaign['scenes'][number]['phase'], spokenVoiceover: string) => ({
  sceneNumber,
  timing: '',
  phase,
  visualDescription: `Plan ${sceneNumber}`,
  onScreenText: '',
  spokenVoiceover,
  soundAndVibe: '',
});

const campaign = (targetProductTitle: string, changes: Partial<MetaAdCampaign> = {}): MetaAdCampaign => ({
  id: `c-${targetProductTitle}`,
  framework: 'PAS',
  frameworkFullName: '',
  targetProductTitle,
  hookHeadline: 'Vos œufs coûtent de plus en plus cher ?',
  metaPrimaryText: '',
  metaHeadline: '',
  callToAction: 'En savoir plus',
  aspectRatio: '9:16',
  durationSeconds: 30,
  scenes: [
    scene(1, 'Problème', 'Le plateau d’œufs a encore augmenté.'),
    scene(2, 'Agitation', 'Chaque semaine, le budget du foyer en prend un coup.'),
    scene(3, 'Solution', 'Avec quatre poules, vous avez vos œufs toute l’année. Le guide vous montre comment, pas à pas, même sans jardin.'),
  ],
  complianceCheck: [],
  metaTargeting: { interests: [], demographics: '', placements: [] },
  ...changes,
});

const product = {
  id: 'p1',
  title: 'Élever des poules en ville',
  subtitle: 'Le guide du débutant',
  transformationPromise: 'Avoir ses œufs frais toute l’année.',
  targetProblem: 'Le prix des œufs monte et la qualité baisse.',
  tableOfContents: [
    { moduleNumber: 1, title: 'Le poulailler', details: '' },
    { moduleNumber: 2, title: 'L’alimentation', details: '' },
    { moduleNumber: 3, title: 'La santé', details: '' },
    { moduleNumber: 4, title: 'La vente', details: '' },
  ],
} as unknown as DigitalProductIdea;

const report = {
  query: 'élevage de poules',
  nicheName: 'Élevage de poules pondeuses en milieu urbain',
  market: 'CM',
  competitors: [
    { id: 'c1', name: 'Ferme Urbaine', urlOrHandle: 'https://www.facebook.com/fermeurbaine' },
    { id: 'c2', name: 'Poules & Co', urlOrHandle: 'poulesetco.mychariow.com' },
  ],
  adCampaigns: [campaign('Un autre ouvrage', { hookHeadline: 'Autre accroche' }), campaign('Élever des poules en ville')],
  audience: { profile: 'Citadins de 25 à 40 ans.', pains: ['Le bruit des voisins', 'Le manque de place', 'Le coût de l’aliment', 'Les maladies'], motivations: [], objections: [], sourceIds: [] },
} as unknown as MarketAnalysisReport;

describe('Ce que l’analyse propose dans chaque module', () => {
  it('Espionnage : le mot-clé est ce que l’auteur a tapé, jamais une phrase', () => {
    assert.equal(spyKeywordOf(report), 'élevage de poules');
    assert.equal(spyKeywordOf({ query: 'x'.repeat(90), nicheName: 'Poules pondeuses' }), 'Poules pondeuses', 'requête trop longue : le nom de la niche');
    assert.equal(spyKeywordOf({ query: 'x'.repeat(90), nicheName: 'y'.repeat(90) }), '', 'rien de court : aucun mot-clé plutôt qu’une phrase');
    assert.equal(spyKeywordOf(null), '');
  });

  it('Radar : seulement une boutique de concurrent qu’il sait suivre', () => {
    assert.equal(followableCompetitorOf(report), 'poulesetco.mychariow.com');
    assert.equal(followableCompetitorOf({ competitors: [report.competitors[0]!] }), '', 'une page Facebook ne se suit pas au radar : rien n’est proposé');
    assert.equal(followableCompetitorOf(null), '');
  });

  it('Campagnes : les chiffres du simulateur de rentabilité, pour que les deux écrans s’accordent', () => {
    assert.deepEqual(campaignNumbersOf(7600), { budget: '380000', targetCpa: '7600' });
    assert.equal(campaignNumbersOf(null), null);
    assert.equal(campaignNumbersOf(0), null);
  });

  it('Storybook : un brief prêt à lancer, sans fait culturel inventé', () => {
    const brief = storybookBriefOf(report);
    assert.equal(brief.heroName, 'Awa');
    assert.match(brief.theme ?? '', /« Élevage de poules pondeuses en milieu urbain »/);
    assert.ok(brief.visualStyle);
    assert.equal('culturalElements' in brief, false, 'les éléments culturels sont des faits : l’auteur les donne');
    assert.equal('theme' in storybookBriefOf(null), false, 'sans niche, pas de thème inventé');
  });

  it('Page produit : la difficulté du lecteur vient de l’ouvrage, sinon de l’analyse', () => {
    const own = productPageDefaultsOf(product, report);
    assert.equal(own.problem, 'Le prix des œufs monte et la qualité baisse.');
    assert.equal(own.headlineB, 'Avoir ses œufs frais toute l’année.', 'la seconde accroche compare la promesse au titre');

    const fromAnalysis = productPageDefaultsOf({ ...product, targetProblem: undefined }, report);
    assert.equal(fromAnalysis.problem, '— Le bruit des voisins\n— Le manque de place\n— Le coût de l’aliment', 'trois difficultés relevées par l’analyse');
    assert.equal(productPageDefaultsOf({ ...product, targetProblem: '' }, null).problem, '', 'ni ouvrage ni analyse : la section reste à écrire');
    assert.equal(productPageDefaultsOf({ ...product, transformationPromise: product.title }, report).headlineB, '', 'une variante identique à la première ne sert à rien');
  });

  const formats: ScriptFormat[] = [
    {
      durationSeconds: 15,
      label: '15 secondes',
      beats: [
        { id: 'hook', label: 'Accroche', startSecond: 0, endSecond: 3, purpose: '' },
        { id: 'benefit', label: 'Bénéfice', startSecond: 3, endSecond: 11, purpose: '' },
        { id: 'cta', label: 'Appel à l’action', startSecond: 11, endSecond: 15, purpose: '' },
      ],
    },
    {
      durationSeconds: 60,
      label: '60 secondes',
      beats: [
        { id: 'hook', label: 'Accroche', startSecond: 0, endSecond: 5, purpose: '' },
        { id: 'problem', label: 'Problème', startSecond: 5, endSecond: 15, purpose: '' },
        { id: 'solution', label: 'Solution', startSecond: 15, endSecond: 35, purpose: '' },
        { id: 'content', label: 'Contenu', startSecond: 35, endSecond: 50, purpose: '' },
        { id: 'cta', label: 'Appel à l’action', startSecond: 50, endSecond: 60, purpose: '' },
      ],
    },
  ];
  const platform = {
    id: 'meta',
    label: 'Meta',
    source: '',
    checkedAt: '',
    buttons: [
      { id: 'learn_more', officialName: 'Learn More', recommendedFor: ['traffic'] },
      { id: 'shop_now', officialName: 'Shop Now', recommendedFor: ['sales'] },
    ],
  } as CtaPlatform;

  it('Kit de lancement : le script de CET ouvrage, pas celui d’un autre', () => {
    assert.equal(scriptFor(report, product)?.targetProductTitle, 'Élever des poules en ville');
    assert.equal(scriptFor(report, { title: 'Inconnu' })?.targetProductTitle, 'Un autre ouvrage', 'à défaut, le premier script de l’analyse');
    assert.equal(scriptFor({ adCampaigns: [] }, product), null);
  });

  it('Kit de lancement : textes, scripts de chaque durée et bouton du marché, voix off tenue dans le temps', () => {
    const kit = launchKitDefaultsOf(product, { report, formats, wordsPerSecond: 2.5, platform, market: 'CM' });

    assert.deepEqual(kit.copies, [{ primaryText: 'Avoir ses œufs frais toute l’année.', headline: 'Élever des poules en ville', description: 'Le guide du débutant' }]);
    assert.deepEqual(kit.ctaByMarket, { CM: 'shop_now' }, 'le bouton conseillé pour vendre, sur le marché de l’analyse');

    const long = kit.scripts['60']!;
    assert.equal(long.hook!.onScreen, 'Vos œufs coûtent de plus en plus cher ?');
    assert.equal(long.hook!.voiceOver, 'Le plateau d’œufs a encore augmenté.');
    assert.equal(long.problem!.voiceOver, 'Le plateau d’œufs a encore augmenté. Chaque semaine, le budget du foyer en prend un coup.');
    assert.match(long.solution!.voiceOver, /^Avec quatre poules/);
    assert.equal(long.content!.voiceOver, 'Au programme : Le poulailler, L’alimentation, La santé.');
    assert.equal(long.content!.onScreen, '4 modules', 'un nombre compté sur l’ouvrage, pas estimé');
    assert.equal(long.solution!.onScreen, 'Avoir ses œufs frais toute l’année.', 'sans texte à l’écran dans le script : la promesse, parce qu’elle tient en une ligne');
    assert.equal(long.cta!.onScreen, 'En savoir plus');

    // Quinze secondes : huit secondes de bénéfice, soit vingt mots au plus — les deux phrases y tiennent tout juste.
    const short = kit.scripts['15']!;
    assert.equal(short.benefit!.voiceOver, 'Avec quatre poules, vous avez vos œufs toute l’année. Le guide vous montre comment, pas à pas, même sans jardin.');
    // Trois secondes d'accroche, huit mots : une voix plus longue s'arrête à la fin de sa première phrase.
    const tight = launchKitDefaultsOf(product, {
      report: { adCampaigns: [campaign('Élever des poules en ville', { scenes: [scene(1, 'Problème', 'Les œufs sont chers. Et ils le seront encore davantage demain, vous le savez bien.')] })] },
      formats,
      wordsPerSecond: 2.5,
    });
    assert.equal(tight.scripts['15']!.hook!.voiceOver, 'Les œufs sont chers.');
    for (const format of formats) {
      for (const beat of format.beats) {
        const words = (kit.scripts[String(format.durationSeconds)]?.[beat.id]?.voiceOver ?? '').split(/\s+/).filter(Boolean).length;
        assert.ok(words <= Math.round((beat.endSecond - beat.startSecond) * 2.5), `${format.label}, ${beat.label} : ${words} mots`);
      }
    }
  });

  it('Kit de lancement : sans analyse, il part quand même de l’ouvrage', () => {
    const kit = launchKitDefaultsOf(product, { formats, wordsPerSecond: 2.5 });
    assert.equal(kit.scripts['15']!.hook!.onScreen, 'Élever des poules en ville');
    assert.equal(kit.scripts['15']!.hook!.voiceOver, 'Avoir ses œufs frais toute l’année.');
    assert.equal(kit.scripts['60']!.problem!.voiceOver, 'Le prix des œufs monte et la qualité baisse.');
    const wordy = launchKitDefaultsOf({ ...product, transformationPromise: 'Une promesse bien trop longue pour tenir en une seule ligne lisible à l’écran d’un téléphone tenu à la main.' }, { formats, wordsPerSecond: 2.5 });
    assert.equal(wordy.scripts['15']!.benefit!.onScreen, '', 'une phrase trop longue n’est pas incrustée, ni coupée');
    assert.equal('cta' in kit.scripts['15']!, false, 'aucun appel à l’action inventé');
    assert.deepEqual(kit.ctaByMarket, {}, 'sans marché, aucun bouton choisi');
    assert.deepEqual(launchKitDefaultsOf(product).scripts, {}, 'tant que les durées ne sont pas connues, pas de script');
  });
});

describe('Un brouillon déjà commencé', () => {
  it('kit : ce qui est vide est complété, ce qui est écrit n’est jamais touché', () => {
    const proposed = {
      productId: 'p1',
      objective: 'sales' as const,
      copies: [{ primaryText: 'Promesse', headline: 'Titre', description: 'Sous-titre' }],
      scripts: { '15': { hook: { onScreen: 'Accroche proposée', voiceOver: 'Voix proposée' }, cta: { onScreen: 'En savoir plus', voiceOver: '' } } },
      ctaByMarket: { CM: 'shop_now' },
    };
    const started = {
      productId: 'p1',
      objective: 'leads' as const,
      copies: [
        { primaryText: 'Mon texte à moi', headline: '', description: '  ' },
        { primaryText: '', headline: '', description: '' },
      ],
      scripts: { '15': { hook: { onScreen: '', voiceOver: 'Ma voix à moi' } }, '30': { hook: { onScreen: 'Écrit par moi', voiceOver: '' } } },
      ctaByMarket: {},
    };
    const completed = completeKitDraft(started, proposed);

    assert.deepEqual(completed.copies[0], { primaryText: 'Mon texte à moi', headline: 'Titre', description: 'Sous-titre' });
    assert.deepEqual(completed.copies[1], { primaryText: '', headline: '', description: '' }, 'une seconde variante vide reste à l’auteur');
    assert.deepEqual(completed.scripts['15']!.hook, { onScreen: 'Accroche proposée', voiceOver: 'Ma voix à moi' });
    assert.deepEqual(completed.scripts['15']!.cta, { onScreen: 'En savoir plus', voiceOver: '' });
    assert.deepEqual(completed.scripts['30'], started.scripts['30'], 'une durée que la proposition ne couvre pas reste telle quelle');
    assert.deepEqual(completed.ctaByMarket, { CM: 'shop_now' });
    assert.equal(completed.objective, 'leads', 'l’objectif choisi est gardé');

    // Des marchés déjà choisis ne sont pas remplacés.
    assert.deepEqual(completeKitDraft({ ...started, ctaByMarket: { SN: '' } }, proposed).ctaByMarket, { SN: '' });
  });
});

describe('Tenir une voix off dans le temps imparti', () => {
  it('garde des phrases entières quand c’est possible', () => {
    assert.equal(limitWords('Un. Deux mots. Et encore trois mots ici.', 4), 'Un. Deux mots.');
    assert.equal(limitWords('Une seule phrase bien trop longue pour tenir', 4), 'Une seule phrase bien');
    assert.equal(limitWords('Court.', 10), 'Court.');
    assert.equal(limitWords('  des   espaces  ', 5), 'des espaces');
  });
});
