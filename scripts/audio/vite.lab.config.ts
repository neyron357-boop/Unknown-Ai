// Audio lab — a tiny separate Vite app for listening to / rendering the v3 engine.
//   npm run audio:lab        (http://localhost:5174)
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root,
  publicDir: false,
  cacheDir: `${repo}.cache/vite-lab`,
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
  server: {
    port: 5174,
    strictPort: true,
    fs: { allow: [repo] },
  },
  build: { outDir: `${repo}.cache/audio-lab-dist`, emptyOutDir: true },
});
