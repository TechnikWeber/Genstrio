import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Shown in the app, so a bug report can name the exact build.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
let commit = process.env.GITHUB_SHA?.slice(0, 7) ?? '';
try {
  commit ||= execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  // Not a git checkout: the version number alone has to do.
}


export default defineConfig({
  // Relative paths, so the build works from any folder (local server, GitHub Pages).
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version), __APP_COMMIT__: JSON.stringify(commit) },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { testTimeout: 60_000 },
});
