import { defineConfig } from 'vite';

// Relative base so the same build works at https://<user>.github.io/<repo>/ and locally.
export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
