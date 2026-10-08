/**
 * Le seul script d'une vidéo animée (voir motion.ts) : il lit le plan des scènes et dresse
 * l'animation GSAP que le moteur HyperFrames rejoue image par image.
 *
 * Règles du moteur, respectées ici : l'animation est créée en pause et rangée dans
 * `window.__timelines` sous l'identifiant de la composition ; rien n'y dépend de l'horloge ni du
 * hasard (ni minuterie, ni tirage) — chaque instant demandé rend la même image. Le script ne
 * montre ni ne cache une scène : c'est le moteur qui le fait, d'après ses attributs de durée.
 *
 * Servi tel quel, comme un fichier : la politique de sécurité du site n'admet aucun script écrit
 * dans la page.
 */
export const MOTION_RUNTIME_JS = [
  '(function () {',
  '  "use strict";',
  '  var source = document.getElementById("plan");',
  '  if (!source || !window.gsap) return;',
  '  var plan = JSON.parse(source.textContent);',
  '  var gsap = window.gsap;',
  '  var timeline = gsap.timeline({ paused: true });',
  '  var moves = {',
  '    "zoom-in": [{ scale: 1, xPercent: 0, yPercent: 0 }, { scale: 1.12 }],',
  '    "zoom-out": [{ scale: 1.12, xPercent: 0, yPercent: 0 }, { scale: 1 }],',
  '    "pan-left": [{ scale: 1.06, xPercent: 3, yPercent: 0 }, { xPercent: -3 }],',
  '    "pan-right": [{ scale: 1.06, xPercent: -3, yPercent: 0 }, { xPercent: 3 }],',
  '    "rise": [{ scale: 1.06, xPercent: 0, yPercent: 3 }, { yPercent: -3 }]',
  '  };',
  '  plan.scenes.forEach(function (scene, index) {',
  '    var root = "#" + scene.id;',
  '    var at = scene.start;',
  '    var move = moves[scene.move] || moves["zoom-in"];',
  '    if (index > 0) timeline.fromTo(root, { opacity: 0 }, { opacity: 1, duration: plan.fade, ease: "power1.out" }, at);',
  '    var to = { duration: scene.seconds + plan.fade, ease: "none" };',
  '    for (var key in move[1]) to[key] = move[1][key];',
  '    timeline.fromTo(root + " .fond", move[0], to, at);',
  '    if (document.querySelector(root + " .surtitre")) timeline.from(root + " .surtitre", { opacity: 0, y: 28, duration: 0.5, ease: "power2.out" }, at + 0.15);',
  '    timeline.from(root + " .mot", { opacity: 0, y: 54, duration: 0.55, ease: "power3.out", stagger: 0.06 }, at + 0.25);',
  '    if (document.querySelector(root + " .corps")) timeline.from(root + " .corps", { opacity: 0, y: 30, duration: 0.5, ease: "power2.out" }, at + 0.75);',
  '    if (document.querySelector(root + " .bouton")) timeline.from(root + " .bouton", { opacity: 0, scale: 0.82, duration: 0.5, ease: "back.out(1.7)" }, at + 1.1);',
  '  });',
  '  timeline.fromTo("#barre", { scaleX: 0 }, { scaleX: 1, duration: plan.total, ease: "none" }, 0);',
  '  window.__timelines = window.__timelines || {};',
  '  window.__timelines[plan.id] = timeline;',
  '})();',
  '',
].join('\n');
