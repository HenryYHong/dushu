import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { bridgeCsp } from './scripts/bridge-csp';
import { claudeBridge } from './scripts/claude-bridge';
import { localModelBridge } from './scripts/local-model';
import { requestedLocalBooks } from './scripts/local-books';
import { nativeSpeech } from './scripts/native-speech';
import { privateAccess, privateGateway } from './scripts/private-access';
import { syncBridge } from './scripts/sync-bridge';

/**
 * The font packages ship each slice as woff2 and as woff. Every browser Dushu supports reads woff2, so the
 * woff fallbacks are dropped before Vite copies files: the build stays half the size and nothing is lost.
 */
function woff2Only(): Plugin {
  return {
    name: 'dushu-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0];
      if (!/node_modules\/(@fontsource\/noto-serif-(sc|tc)|lxgw-wenkai-webfont)\/.*\.css$/.test(file)) return null;
      return { code: code.replace(/,\s*url\([^)]*\.woff['"]?\)\s*format\(['"]woff['"]\)/g, ''), map: null };
    },
  };
}

/**
 * One hash of the bytes of every file under these folders of the build. The static cache is named by it, so a release that
 * changes only a classic or a font, or a data file whose size stays the same, still reaches installed apps.
 */
export function contentVersion(dist: string, dirs: string[]): string {
  const hash = createHash('sha1');
  for (const dir of dirs) {
    const root = join(dist, dir);
    if (!existsSync(root)) continue;
    const files = (readdirSync(root, { recursive: true }) as string[]).map((f) => f.split(sep).join('/')).sort();
    for (const f of files) {
      if (!statSync(join(root, f)).isFile()) continue;
      hash.update(`${dir}/${f}\0`).update(readFileSync(join(root, f))).update('\0');
    }
  }
  return hash.digest('hex').slice(0, 10);
}

/** Fills the placeholders in the built sw.js: a build id, the data version, and the files to precache. */
export function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'dushu-sw',
    apply: 'build',
    // Whatever folder this build writes to (--outDir included), never a hard-coded one.
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const dist = outDir;
      const swPath = join(dist, 'sw.js');
      if (!existsSync(swPath)) return;
      // Font slices are not precached: the ones a book uses are cached the first time they are fetched. The PDF worker
      // (1.4 MB) and the Chinese CMaps (0.8 MB) are, so a PDF imports offline; sw.js copies unchanged hashed files from the
      // previous build's cache, so an update does not download them again.
      const assets = readdirSync(join(dist, 'assets')).filter((f) => /\.(js|mjs|css|bcmap)$/.test(f));
      const data = readdirSync(join(dist, 'data'));
      const build = createHash('sha1').update(assets.join('|')).digest('hex').slice(0, 10);
      const dataVersion = contentVersion(dist, ['data', 'samples', 'fonts']);
      const icons = existsSync(join(dist, 'icons')) ? readdirSync(join(dist, 'icons')).map((f) => `icons/${f}`) : [];
      // The classics (text and their index) are fetched ahead too, so adding one works without a connection.
      const samples = existsSync(join(dist, 'samples')) ? readdirSync(join(dist, 'samples')).filter((f) => /\.(?:txt|json)$/.test(f)).map((f) => `samples/${f}`) : [];
      const precache = [...assets.map((f) => `assets/${f}`), ...data.map((f) => `data/${f}`), ...samples, 'icon.svg', 'manifest.webmanifest', ...icons];
      writeFileSync(swPath, readFileSync(swPath, 'utf8')
        .replace('__BUILD__', build).replace('__DATA_VERSION__', dataVersion).replace('__PRECACHE__', JSON.stringify(precache)));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [privateGateway(), bridgeCsp(), woff2Only(), serviceWorker(), requestedLocalBooks(), nativeSpeech(), localModelBridge(), claudeBridge(), syncBridge()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
  server: { port: 5173, allowedHosts: [privateAccess()?.host.split(':')[0] ?? 'localhost'] },
  preview: { allowedHosts: [privateAccess()?.host.split(':')[0] ?? 'localhost'] },
  // Pre-bundle the lazily imported packages so the dev server does not reload the page when it first meets them.
  optimizeDeps: { include: ['hanzi-writer', 'pdfjs-dist', 'fflate'] },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    setupFiles: ['tests/setup/wait.ts'],
  },
});
