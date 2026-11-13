import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Emits dist/sw.js from src/pwa/sw-template.js with the list of built files to precache. */
function serviceWorker(): Plugin {
  return {
    name: 'kansei-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const extra = ['./', 'index.html', 'manifest.webmanifest', 'favicon.png',
        'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
      const precache = [...new Set([...extra, ...files.filter((f) => f !== 'index.html')])];
      const build = Date.now().toString(36);
      const src = readFileSync('src/pwa/sw-template.js', 'utf8')
        .replace('__BUILD__', build)
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

// Relative base so the same build works at https://<user>.github.io/<repo>/ and locally.
export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4500 },
  plugins: [serviceWorker()],
});
