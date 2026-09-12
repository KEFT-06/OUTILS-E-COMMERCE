import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.PORT ?? '3001';

  return {
    plugins: [react(), tailwindcss()],

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
      // par le backend, qui seul détient les clés. Cf. docs/ARCHITECTURE.md.
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },

    build: {
      outDir: 'dist/client',
      sourcemap: mode !== 'production',
      rollupOptions: {
        output: {
          // Découpage manuel : recharts + jspdf pèsent lourd et ne sont pas
          // nécessaires au premier rendu.
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-charts': ['recharts'],
            'vendor-pdf': ['jspdf'],
            'vendor-motion': ['motion', 'framer-motion'],
          },
        },
      },
    },
  };
});
