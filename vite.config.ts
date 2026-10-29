/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // geotiff lazy-loads its decoders via dynamic import; IIFE workers can't code-split.
  worker: { format: 'es' },
  // Pre-bundle worker deps up front; otherwise the first file open triggers a dev-server reload.
  optimizeDeps: { exclude: ['h5wasm'], include: ['geotiff', 'fflate', 'comlink'] },
  build: { target: 'es2022' },
  test: { environment: 'node' },
});
