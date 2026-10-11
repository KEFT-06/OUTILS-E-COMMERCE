import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readProductStart } from '@/modules/creatifs/adReference';
import { screenLine, shorten, videoFromKit, videoFromScript, videoFromStorybook } from '@/modules/creatifs/videoStart';
import type { MetaAdCampaign } from '@/shared/types/analysis';
import type { ScriptFormat } from '@/shared/types/launchKit';
import type { StorybookEntry } from '@/shared/types/storybook';

/**
 * « Créer une vidéo » depuis un script du dossier, un conte ou un kit : ce qui arrive dans le brief.
 *
 * L'auteur ne doit rien ressaisir, et rien ne doit être inventé pour lui. Chaque brief passe aussi
 * par la lecture de l'écran des Créatifs (`readProductStart`), qui ne fait confiance à rien de ce
 * qu'on lui remet.
 */

const scene = (sceneNumber: number, phase: MetaAdCampaign['scenes'][number]['phase'], visualDescription: string, spokenVoiceover: string, onScreenText = '') => ({
  sceneNumber,
  timing: `0:0${sceneNumber} - 0:0${sceneNumber + 1}`,
  phase,
  visualDescription,
  onScreenText,
  spokenVoiceover,
  soundAndVibe: '',
});

const script = (changes: Partial<MetaAdCampaign> = {}): MetaAdCampaign => ({
  id: 'c1',
  framework: 'PAS',
  frameworkFullName: 'Problème, Agitation, Solution',
  targetProductTitle: 'Élever des poules en ville',
  hookHeadline: 'Vos œufs coûtent de plus en plus cher ?',
  metaPrimaryText: '',
  metaHeadline: '',
  callToAction: 'En savoir plus',
  aspectRatio: '1:1',
  durationSeconds: 30,
  scenes: [
    scene(1, 'Problème', 'Une femme regarde le prix des œufs au marché.', 'Le plateau d’œufs a encore augmenté.'),
    scene(2, 'Agitation', 'Elle compte ses pièces devant l’étal.', 'Chaque semaine, le budget du foyer en prend un coup.'),
    scene(3, 'Solution', 'La même femme ramasse des œufs dans sa cour.', 'Avec quatre poules, vous avez vos œufs toute l’année.'),
  ],
  complianceCheck: [],
  metaTargeting: { interests: [], demographics: 'Femmes de 25 à 45 ans, en ville', placements: [] },
  ...changes,
});

describe('« Créer une vidéo » : le brief part rempli', () => {
  it('un script du dossier : ce qu’on voit fait la scène, ce qu’on dit fait les temps de la méthode', () => {
    const { produit } = videoFromScript(script(), { audience: 'Citadines qui veulent réduire leurs dépenses', market: 'CM' });
    const lu = readProductStart({ produit })!;

    assert.equal(lu.titre, 'Élever des poules en ville');
    assert.equal(lu.promesse, 'Vos œufs coûtent de plus en plus cher ?');
    assert.equal(lu.public, 'Citadines qui veulent réduire leurs dépenses', 'le public de l’analyse passe avant le ciblage du script');
    assert.equal(lu.methode, 'pas');
    assert.deepEqual(lu.temps, ['Le plateau d’œufs a encore augmenté.', 'Chaque semaine, le budget du foyer en prend un coup.', 'Avec quatre poules, vous avez vos œufs toute l’année.']);
    assert.equal(lu.scene, '1. Une femme regarde le prix des œufs au marché.\n2. Elle compte ses pièces devant l’étal.\n3. La même femme ramasse des œufs dans sa cour.');
    assert.equal(lu.niveau, 'problem_aware');
    assert.equal(lu.format, '9:16', 'un script carré part en vertical : la vidéo n’a pas de carré');
    assert.equal(lu.marche, 'CM');
    assert.equal(lu.origine, 'le script PAS de votre dossier');
  });

  it('sans public dans l’analyse, celui du ciblage du script', () => {
    assert.equal(readProductStart(videoFromScript(script()))!.public, 'Femmes de 25 à 45 ans, en ville');
  });

  it('un script « UGC » suit la méthode de ses scènes', () => {
    const ugc = script({
      framework: 'UGC',
      scenes: [scene(1, 'Attention', 'Un visage face caméra.', 'J’ai arrêté d’acheter mes œufs.'), scene(2, 'Désir', 'Le poulailler dans la cour.', ''), scene(3, 'Action', 'Le guide sur un téléphone.', 'Le guide est en lien.')],
    });
    const lu = readProductStart(videoFromScript(ugc))!;
    assert.equal(lu.methode, 'aida');
    assert.deepEqual(lu.temps, ['J’ai arrêté d’acheter mes œufs.', '', '', 'Le guide est en lien.'], 'un temps sans parole reste vide : la consigne de la méthode le remplace');
    assert.equal(lu.niveau, 'product_aware');
  });

  it('un long script : la scène garde des plans entiers, jamais une phrase coupée', () => {
    const long = script({ scenes: Array.from({ length: 12 }, (_, index) => scene(index + 1, 'Solution', `Plan ${index + 1} : ${'la cour au petit matin, '.repeat(9)}fin.`, '')) });
    const lu = readProductStart(videoFromScript(long))!;
    assert.ok(lu.scene.length <= 1500);
    assert.ok(lu.scene.split('\n').every((ligne) => ligne.endsWith('fin.')), 'chaque plan gardé est entier');
  });

  // Tel qu'un conte est enregistré : son texte dans sa langue, ses consignes d'illustration en anglais.
  const conte = {
    title: 'Le petit manguier d’Awa',
    language: 'fr',
    country: 'CM',
    story: {
      title: 'Le petit manguier d’Awa',
      characterSheet: 'Awa, a 7-year-old girl with yellow ribbons in her pigtails.',
      coverIllustration: 'Warm watercolor style. A girl smiles under a mango tree.',
      pages: [
        { heading: 'La graine', text: 'Awa trouva une graine au marché de Mokolo.', illustration: 'A hand holding a seed.' },
        { heading: 'La pluie', text: 'Elle l’arrosa chaque matin.', illustration: 'A girl watering a sprout.' },
      ],
    },
  } as unknown as StorybookEntry;

  it('un conte : son titre, le début de son histoire, sa langue — et aucune accroche inventée', () => {
    const lu = readProductStart(videoFromStorybook(conte))!;
    assert.equal(lu.titre, 'Le petit manguier d’Awa');
    assert.equal(lu.promesse, 'Le petit manguier d’Awa');
    assert.equal(
      lu.scene,
      'Le livre illustré pour enfants « Le petit manguier d’Awa » s’ouvre et son histoire prend vie.\nL’histoire commence : Awa trouva une graine au marché de Mokolo.\nPuis un parent et son enfant tournent ensemble les pages du livre, souriants.',
    );
    assert.doesNotMatch(lu.scene, /watercolor|pigtails|holding/, 'les consignes d’illustration, en anglais, ne passent pas sous les yeux de l’auteur');
    assert.equal(lu.langue, 'fr', 'la vidéo parle la langue du conte');
    assert.equal(lu.marche, 'CM');
    assert.equal(lu.methode, 'aida');
    assert.deepEqual(lu.temps, [], 'les temps restent ceux de la méthode : l’outil n’écrit pas d’accroche à la place de l’auteur');
    assert.equal(lu.niveau, 'product_aware');
  });

  it('un conte en anglais : son brief est en anglais d’un bout à l’autre', () => {
    const anglais = { ...conte, title: 'Awa’s Little Mango Tree', language: 'en', story: { ...conte.story, pages: [{ heading: 'The seed', text: 'Awa found a seed at the market.', illustration: 'A hand holding a seed.' }] } } as unknown as StorybookEntry;
    const lu = readProductStart(videoFromStorybook(anglais))!;
    assert.equal(lu.langue, 'en');
    assert.equal(lu.public, 'Parents of young children');
    assert.match(lu.scene, /^The illustrated children’s book “Awa’s Little Mango Tree” opens/);
    assert.match(lu.scene, /The story begins: Awa found a seed at the market\./);
    assert.doesNotMatch(lu.scene, /livre|histoire|parent et son enfant/);
  });

  const format: ScriptFormat = {
    durationSeconds: 60,
    label: '60 secondes',
    beats: [
      { id: 'hook', label: 'Accroche', startSecond: 0, endSecond: 5, purpose: '' },
      { id: 'problem', label: 'Problème', startSecond: 5, endSecond: 15, purpose: '' },
      { id: 'solution', label: 'Solution', startSecond: 15, endSecond: 35, purpose: '' },
      { id: 'content', label: 'Contenu', startSecond: 35, endSecond: 50, purpose: '' },
      { id: 'cta', label: 'Appel à l’action', startSecond: 50, endSecond: 60, purpose: '' },
    ],
  };
  const ouvrage = { title: 'Élever des poules en ville', targetAudience: 'Les citadins qui débutent.', transformationPromise: 'Avoir ses œufs frais toute l’année.' };

  it('un kit de lancement : ses temps se rangent dans ceux de la méthode', () => {
    const { produit } = videoFromKit(ouvrage, {
      format,
      beats: {
        hook: { onScreen: 'Des œufs frais chez vous', voiceOver: 'Et si vos œufs venaient de votre cour ?' },
        problem: { onScreen: '', voiceOver: 'Au marché, le prix ne cesse de monter.' },
        solution: { onScreen: '', voiceOver: 'Quatre poules suffisent.' },
        content: { onScreen: '', voiceOver: 'Le guide détaille le poulailler et l’alimentation.' },
        cta: { onScreen: 'Le guide est en lien', voiceOver: '' },
      },
      objective: 'leads',
      market: 'SN',
    });
    const lu = readProductStart({ produit })!;
    assert.equal(lu.methode, 'aida');
    assert.deepEqual(lu.temps, [
      'Et si vos œufs venaient de votre cour ?',
      'Au marché, le prix ne cesse de monter.',
      'Quatre poules suffisent. Le guide détaille le poulailler et l’alimentation.',
      'Le guide est en lien',
    ]);
    assert.equal(lu.promesse, 'Des œufs frais chez vous', 'le texte à l’écran est celui de l’accroche');
    assert.equal(lu.scene, 'Une personne du public visé découvre « Élever des poules en ville » sur son téléphone, dans son quotidien. Avoir ses œufs frais toute l’année.');
    assert.equal(lu.public, 'Les citadins qui débutent.');
    assert.equal(lu.niveau, 'problem_aware');
    assert.equal(lu.marche, 'SN');
  });

  it('un kit encore vide : le brief part quand même de l’ouvrage', () => {
    const lu = readProductStart(videoFromKit(ouvrage, { format, beats: undefined, objective: 'sales' }))!;
    assert.deepEqual(lu.temps, []);
    assert.equal(lu.promesse, 'Avoir ses œufs frais toute l’année.');
    assert.equal(lu.niveau, 'product_aware');
    assert.ok(lu.scene.length >= 3, 'la scène suffit à lancer la vidéo');
  });
});

describe('Le point de départ d’une vidéo, relu sans lui faire confiance', () => {
  it('écarte ce que le serveur refuserait : méthode, langue, format ou pays inconnus', () => {
    const lu = readProductStart({ produit: { titre: 'Guide', methode: 'inconnue', temps: ['a', 'b'], langue: 'xx', format: '1:1', marche: 'cameroun', niveau: 'tiède' } })!;
    assert.equal(lu.methode, null);
    assert.deepEqual(lu.temps, [], 'des temps sans méthode n’ont pas de sens');
    assert.equal(lu.langue, null);
    assert.equal(lu.format, null);
    assert.equal(lu.marche, null);
    assert.equal(lu.niveau, null);
  });

  it('borne chaque texte aux limites du brief', () => {
    const lu = readProductStart({ produit: { titre: 't'.repeat(400), promesse: 'p'.repeat(400), public: 'u'.repeat(900), scene: 's'.repeat(5_000), methode: 'aida', temps: Array.from({ length: 9 }, () => 'x'.repeat(500)) } })!;
    assert.equal(lu.titre.length, 120);
    assert.equal(lu.promesse.length, 120);
    assert.equal(lu.public.length, 300);
    assert.equal(lu.scene.length, 1500);
    assert.equal(lu.temps.length, 6);
    assert.ok(lu.temps.every((temps) => temps.length === 200));
  });

  it('sans titre, on n’arrive de nulle part', () => {
    assert.equal(readProductStart({ produit: { titre: '   ' } }), null);
    assert.equal(readProductStart(null), null);
    assert.equal(readProductStart({ produit: 'texte' }), null);
  });
});

describe('Le texte incrusté dans la vidéo', () => {
  it('n’est jamais une phrase coupée : la première proposition qui tient en entier, sinon rien', () => {
    const longue = 'Savoir optimiser son emplacement, son timing et sa gestion comptable pour stabiliser ses revenus journaliers.';
    assert.equal(screenLine('Des œufs frais chez vous', longue), 'Des œufs frais chez vous');
    assert.equal(screenLine(longue, 'Vendre ses beignets devant l’école'), 'Vendre ses beignets devant l’école', 'une promesse trop longue laisse la place au titre');
    assert.equal(screenLine(longue, null, undefined, '  '), '', 'rien ne tient : aucun texte, plutôt qu’une phrase amputée');

    const kit = videoFromKit({ title: 'Vendre ses beignets devant l’école', targetAudience: '', transformationPromise: longue }, { objective: 'sales' });
    assert.equal(readProductStart(kit)!.promesse, 'Vendre ses beignets devant l’école');
    assert.ok(!readProductStart(kit)!.promesse.includes('…'));
  });
});

describe('Raccourcir un texte', () => {
  it('coupe à la fin d’un mot, et laisse intact ce qui tient', () => {
    assert.equal(shorten('Avoir ses œufs frais', 80), 'Avoir ses œufs frais');
    const court = shorten('Avoir ses œufs frais toute l’année, sans dépendre du marché ni de ses prix', 40);
    assert.ok(court.length <= 40);
    assert.ok(court.endsWith('…'));
    assert.ok(!/\s…$/.test(court), 'pas d’espace avant les points de suspension');
    assert.equal(court, 'Avoir ses œufs frais toute l’année…');
  });
});
