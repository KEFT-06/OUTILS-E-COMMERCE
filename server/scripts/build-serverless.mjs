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
  external: ['@node-rs/argon2', '@electric-sql/pglite', 'drizzle-orm/pglite', 'drizzle-orm/pglite/migrator'],
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
