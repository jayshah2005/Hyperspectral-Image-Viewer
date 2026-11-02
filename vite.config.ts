/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs so the build works under a sub-path (GitHub Pages serves /<repo>/).
  base: './',
  // geotiff lazy-loads its decoders via dynamic import; IIFE workers can't code-split.
  worker: { format: 'es' },
  // Pre-bundle worker deps up front; otherwise the first file open triggers a dev-server reload.
  optimizeDeps: { exclude: ['h5wasm', '@huggingface/transformers'], include: ['geotiff', 'fflate', 'comlink'] },
  build: { target: 'es2022' },
  // Multi-threading for SAM on the processor. On GitHub Pages, public/coi-sw.js provides these instead.
  server: { headers: ISOLATION },
  preview: { headers: ISOLATION },
  test: { environment: 'node' },
});
