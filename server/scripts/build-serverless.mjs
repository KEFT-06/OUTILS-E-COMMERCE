import { build } from 'esbuild';

/**
 * Assemble le serveur pour Vercel en UN seul fichier, dépendances comprises.
 *
 * Il était assemblé avec `--packages=external` : chaque dépendance (express, zod, drizzle,
 * postgres…) se résolvait au démarrage depuis node_modules, soit des milliers de petits
 * fichiers lus un par un. Mesuré le 28/09/2026 : 6,2 s de chargement du module, puis 18 ms par
 * requête. Sur Vercel, ce démarrage à froid tenait l'écran noir 9 à 14 secondes à la première
 * visite. Un seul fichier se charge en une fraction de seconde.
 *
 * Restent à part, et seulement eux :
 *  - @node-rs/argon2 : module natif (binaire propre à la plateforme), impossible à assembler ;
 *  - PGlite : base embarquée du développement, jamais chargée en production, et qui lit ses
 *    fichiers WebAssembly à côté d'elle.
 *  - html2canvas, canvg, dompurify : modules facultatifs de jsPDF (rendu de HTML et de SVG), que
 *    le PDF des contes n'appelle jamais. jsPDF ne les charge qu'à l'intérieur de ces fonctions-là ;
 *    assemblés, ils ajoutaient 1,8 Mo à lire à chaque démarrage à froid, pour rien.
 *
 * Les dépendances écrites en CommonJS appellent `require`, `__dirname` et `__filename`, absents
 * d'un module ES : la bannière les recrée à partir de l'adresse du fichier.
 */
await build({
  entryPoints: ['server/vercel.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/vercel.js',
  sourcemap: true,
  // Date de mise en ligne, lue par le plan du site : chez l'hébergeur, les fichiers portent une
  // date fixe vieille de plusieurs années, qui faisait annoncer « modifié en 2018 » aux moteurs.
  define: { __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  external: [
    '@node-rs/argon2',
    '@electric-sql/pglite',
    'drizzle-orm/pglite',
    'drizzle-orm/pglite/migrator',
    'html2canvas',
    'canvg',
    'dompurify',
  ],
  banner: {
    js: [
      "import { createRequire as __smartCreatorRequire } from 'node:module';",
      "import { fileURLToPath as __smartCreatorPath } from 'node:url';",
      "import { dirname as __smartCreatorDirname } from 'node:path';",
      'const require = __smartCreatorRequire(import.meta.url);',
      'const __filename = __smartCreatorPath(import.meta.url);',
      'const __dirname = __smartCreatorDirname(__filename);',
    ].join('\n'),
  },
  logLevel: 'warning',
});
