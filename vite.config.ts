import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative paths, so the build works from any folder (local server, GitHub Pages).
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { testTimeout: 60_000 },
});
