import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  dts: true,
  splitting: false,
  shims: false,
  minify: false,
  // The web client is served straight from disk by Express, so it is copied
  // verbatim rather than bundled.
  publicDir: 'public',
});
