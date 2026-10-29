/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs so the build works under a sub-path (GitHub Pages serves /<repo>/).
  base: './',
  // geotiff lazy-loads its decoders via dynamic import; IIFE workers can't code-split.
  worker: { format: 'es' },
  // Pre-bundle worker deps up front; otherwise the first file open triggers a dev-server reload.
  optimizeDeps: { exclude: ['h5wasm'], include: ['geotiff', 'fflate', 'comlink'] },
  build: { target: 'es2022' },
  test: { environment: 'node' },
});
