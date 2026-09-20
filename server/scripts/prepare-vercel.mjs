import { mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Prépare la sortie de construction pour un hébergement sans serveur.
 *
 * Vercel sert d'abord les fichiers du dossier public, puis seulement ensuite redirige vers
 * la fonction. Tant que `dist/client/index.html` existe, l'adresse « / » lui est servie
 * telle quelle, sans passer par le serveur — et la page perdrait les balises de
 * référencement que le serveur écrit pour chaque adresse (titre, description, robots).
 *
 * Le modèle est donc déplacé hors du dossier distribué : les fichiers versionnés
 * (scripts, images, polices) restent sur le réseau de diffusion, et toutes les pages HTML
 * sont rendues par le serveur.
 */

const root = process.cwd();
const from = join(root, 'dist', 'client', 'index.html');
const to = join(root, 'dist', 'app-shell', 'index.html');

if (!existsSync(from)) {
  console.error(`❌ ${from} est introuvable : lancez d'abord la construction du site.`);
  process.exit(1);
}

mkdirSync(dirname(to), { recursive: true });
renameSync(from, to);
console.log('  Modèle HTML déplacé vers dist/app-shell/ : les pages seront rendues par le serveur.');
