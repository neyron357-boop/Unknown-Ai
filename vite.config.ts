/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

const API_PORT = Number(process.env.PORT ?? 8787);
/**
 * VITE_TARGET=artifact → a self-contained single-page build (no service worker, no API server,
 * fonts inlined, one JS bundle) that `scripts/build-artifact.mjs` folds into one HTML file.
 */
const ARTIFACT = process.env.VITE_TARGET === 'artifact';

export default defineConfig({
  base: ARTIFACT ? './' : '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      ...(ARTIFACT ? { 'virtual:pwa-register': fileURLToPath(new URL('./src/pwa-stub.ts', import.meta.url)) } : {}),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    !ARTIFACT &&
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'UNKNOWN: ASCENSION',
        short_name: 'UNKNOWN',
        description: 'Кинематографичный экшен, где побеждает тот, кто видит закономерность.',
        lang: 'ru',
        start_url: '/',
        scope: '/',
        display: 'fullscreen',
        orientation: 'portrait',
        background_color: '#050507',
        theme_color: '#050507',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // voice/*.mp3 + voice/manifest.json: the character voices play offline too (~2 MB)
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mp3,json}'],
        // Only Latin + Cyrillic font subsets are precached for offline play.
        globIgnores: ['**/*-greek-*', '**/*-vietnamese-*', '**/*-latin-ext-*', '**/*-cyrillic-ext-*'],
        // Phaser bundle is large; allow precaching it so the game works offline.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
  build: ARTIFACT
    ? {
        target: 'es2020',
        outDir: 'dist-artifact',
        chunkSizeWarningLimit: 4000,
        // Inline every asset (fonts) as data: URIs — the artifact sandbox loads nothing else.
        assetsInlineLimit: () => true,
        rollupOptions: { output: { inlineDynamicImports: true } },
      }
    : {
        target: 'es2020',
        chunkSizeWarningLimit: 1600,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules/phaser')) return 'phaser';
              return undefined;
            },
          },
        },
      },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
