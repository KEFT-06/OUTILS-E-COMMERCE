import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.PORT ?? '3001';

  return {
    plugins: [
      react(),
      tailwindcss(),
      // En développement seulement : en production, le serveur écrit l'adresse publique
      // et les balises propres à chaque page (server/services/seo).
      {
        name: 'adresse-publique',
        apply: 'serve',
        transformIndexHtml: (html) => html.replaceAll('__APP_URL__', (env.APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '')),
      },
    ],

    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@server': fileURLToPath(new URL('./server', import.meta.url)),
      },
    },

    server: {
      port: 5173,
      strictPort: false,
      // Le front n'appelle JAMAIS un fournisseur IA directement : tout passe
      // par le backend, qui seul détient les clés. Cf. README.md, section « Architecture ».
      proxy: {
        '/api': {
          // IPv4 explicite : l'API n'écoute que sur 127.0.0.1 en développement,
          // alors que « localhost » peut désigner ::1 sous Windows.
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },

    build: {
      outDir: 'dist/client',
      sourcemap: mode !== 'production',
      rollupOptions: {
        output: {
          // Seul le noyau React est regroupé à la main : il change rarement et reste en cache d'un
          // déploiement à l'autre. Tout le reste (graphiques, PDF, briques d'interface) est
          // découpé par Rollup selon les pages qui s'en servent. Les regrouper à la main les
          // attachait au premier téléchargement : l'accueil chargeait 1,8 Mo de JavaScript.
          manualChunks(id) {
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser)[\\/]/.test(id)) {
              return 'vendor-react';
            }
            return undefined;
          },
        },
      },
    },
  };
});
