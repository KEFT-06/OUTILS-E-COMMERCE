import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MOTION_SIZES, type MotionScenario, buildMotionComposition, motionTimings } from '@server/shared/motion';
import { MOTION_RUNTIME_JS } from '@server/shared/motionRuntime';

/**
 * Vidéo animée : la page HyperFrames tirée d'un scénario. Fonctions pures, aucun service.
 *
 * Ce que ces tests verrouillent : le contrat du moteur (chaque scène porte son instant et sa
 * durée, deux scènes qui se chevauchent ne partagent pas une piste, l'animation est en pause et
 * rangée sous l'identifiant de la composition), et le fait qu'aucun texte de scène ne peut
 * devenir du code dans la page.
 */

const SCENARIO: MotionScenario = {
  title: 'Vendre ses beignets devant l’école',
  theme: 'foret',
  callToAction: 'Je commence',
  scenes: [
    { id: 's1', seconds: 3, kicker: 'Le problème', headline: 'Vos beignets sont bons, mais personne ne s’arrête', body: 'Ce n’est pas la recette.', voiceover: '', visual: 'a street vendor', move: 'zoom-in', layout: 'bottom' },
    { id: 's2', seconds: 4.5, kicker: '', headline: 'L’emplacement décide', body: '', voiceover: '', visual: 'a school gate', move: 'pan-left', layout: 'center' },
    { id: 's3', seconds: 4, kicker: 'La méthode', headline: 'Un cahier, une semaine, un kilo', body: 'Changez une seule chose à la fois.', voiceover: '', visual: 'a notebook', move: 'rise', layout: 'top' },
  ],
};

const OPTIONS = { format: '9:16' as const, gsapUrl: '/motion/gsap.min.js', runtimeUrl: '/api/creatives/motion/runtime.js' };

const clips = (html: string) =>
  [...html.matchAll(/<div id="(s\d+)" class="clip scene (\w+)"[^>]*data-start="([\d.]+)" data-duration="([\d.]+)" data-track-index="(\d+)"/g)].map((match) => ({
    id: match[1]!,
    layout: match[2]!,
    start: Number(match[3]),
    duration: Number(match[4]),
    track: Number(match[5]),
  }));

describe('Vidéo animée — la page tirée du scénario', () => {
  it('donne à chaque scène son instant, sa durée et sa piste, et à la composition sa taille et sa durée', () => {
    const html = buildMotionComposition(SCENARIO, OPTIONS);
    assert.match(html, /<div id="stage" data-composition-id="video" data-start="0" data-duration="11\.5" data-width="1080" data-height="1920">/);
    assert.deepEqual(motionTimings(SCENARIO), { scenes: [{ id: 's1', start: 0, seconds: 3 }, { id: 's2', start: 3, seconds: 4.5 }, { id: 's3', start: 7.5, seconds: 4 }], total: 11.5 });

    const scenes = clips(html);
    assert.deepEqual(scenes.map((scene) => [scene.id, scene.start, scene.layout]), [['s1', 0, 'bottom'], ['s2', 3, 'center'], ['s3', 7.5, 'top']]);
    // Une scène reste le temps du fondu de la suivante ; la dernière s'arrête à la fin de la vidéo.
    assert.deepEqual(scenes.map((scene) => scene.duration), [3.45, 4.95, 4]);
    for (const [index, scene] of scenes.entries()) {
      const suivante = scenes[index + 1];
      if (suivante && scene.start + scene.duration > suivante.start) assert.notEqual(scene.track, suivante.track, 'deux scènes qui se chevauchent ne partagent pas une piste');
    }
    assert.match(html, /class="clip progression" data-start="0" data-duration="11\.5" data-track-index="2"/);
    // Le bouton n'apparaît que sur la dernière scène.
    assert.equal(html.split('class="bouton"').length - 1, 1);
    assert.ok(html.indexOf('class="bouton"') > html.indexOf('id="s3"'));
  });

  it('suit le format demandé, et pose l’image de fond de chaque scène qui en a une', () => {
    for (const format of ['9:16', '16:9', '1:1'] as const) {
      const { width, height } = MOTION_SIZES[format];
      assert.ok(buildMotionComposition(SCENARIO, { ...OPTIONS, format }).includes(`data-width="${width}" data-height="${height}"`));
    }
    const html = buildMotionComposition(SCENARIO, { ...OPTIONS, images: { s2: '/api/creatives/requests/abc/file?x=1&y=2' } });
    assert.match(html, /<img class="fond" src="\/api\/creatives\/requests\/abc\/file\?x=1&amp;y=2" alt="">/);
    assert.equal(html.split('class="fond uni"').length - 1, 2, 'les deux autres scènes gardent le dégradé du thème');
  });

  it('ne laisse aucun texte de scène devenir du code, et n’embarque que nos deux scripts', () => {
    const piege = '</script><script>alert(1)</script><img src=x onerror=alert(2)>';
    const html = buildMotionComposition(
      { ...SCENARIO, title: piege, callToAction: piege, scenes: SCENARIO.scenes.map((scene) => ({ ...scene, id: scene.id, kicker: piege, headline: piege, body: piege })) },
      OPTIONS,
    );
    assert.ok(!html.includes('<script>alert'), 'aucune balise de script ouverte par un texte');
    assert.ok(!html.includes('<img src=x'), 'aucune balise ouverte par un texte');
    assert.deepEqual([...html.matchAll(/<script[^>]*>/g)].map((match) => match[0]), [
      '<script type="application/json" id="plan">',
      '<script src="/motion/gsap.min.js">',
      '<script src="/api/creatives/motion/runtime.js">',
    ]);
    // Le plan lu par notre script ne porte que des instants et des mouvements : aucun texte d'auteur.
    const plan = JSON.parse(/<script type="application\/json" id="plan">([^<]*)<\/script>/.exec(html)![1]!) as { id: string; total: number; scenes: Record<string, unknown>[] };
    assert.equal(plan.id, 'video');
    assert.deepEqual(Object.keys(plan.scenes[0]!).sort(), ['id', 'move', 'seconds', 'start']);
  });

  it('rend la même page pour le même scénario, et un script que le moteur peut rejouer image par image', () => {
    assert.equal(buildMotionComposition(SCENARIO, OPTIONS), buildMotionComposition(SCENARIO, OPTIONS));
    assert.match(MOTION_RUNTIME_JS, /gsap\.timeline\(\{ paused: true \}\)/);
    assert.match(MOTION_RUNTIME_JS, /window\.__timelines\[plan\.id\] = timeline/);
    // Ni hasard ni horloge : chaque instant demandé doit rendre la même image.
    assert.doesNotMatch(MOTION_RUNTIME_JS, /Math\.random|setTimeout|setInterval|Date\.now|requestAnimationFrame/);
    // Le script se lit comme du JavaScript valide.
    assert.doesNotThrow(() => new Function(MOTION_RUNTIME_JS));
  });
});
