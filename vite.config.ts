import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { nativeSpeech } from './scripts/native-speech';
import { privateAccess, privateGateway, trustedRequest } from './scripts/private-access';
import { localModelBridge } from './scripts/local-model';

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

/** Fills the placeholders in dist/sw.js: a build id, the data version, and the files to precache. */
function serviceWorker(): Plugin {
  return {
    name: 'dushu-sw',
    apply: 'build',
    closeBundle() {
      const dist = 'dist';
      const swPath = join(dist, 'sw.js');
      if (!existsSync(swPath)) return;
      // Font slices are not precached: the ones a book uses are cached the first time they are fetched.
      const assets = readdirSync(join(dist, 'assets')).filter((f) => /\.(js|css)$/.test(f) && !/pdf\.worker/.test(f));
      const data = readdirSync(join(dist, 'data'));
      const build = createHash('sha1').update(assets.join('|')).digest('hex').slice(0, 10);
      const dataVersion = createHash('sha1').update(data.map((f) => readFileSync(join(dist, 'data', f)).length + f).join('|')).digest('hex').slice(0, 10);
      const icons = existsSync(join(dist, 'icons')) ? readdirSync(join(dist, 'icons')).map((f) => `icons/${f}`) : [];
      const precache = [...assets.map((f) => `assets/${f}`), ...data.map((f) => `data/${f}`), 'icon.svg', 'manifest.webmanifest', ...icons];
      writeFileSync(swPath, readFileSync(swPath, 'utf8')
        .replace('__BUILD__', build).replace('__DATA_VERSION__', dataVersion).replace('__PRECACHE__', JSON.stringify(precache)));
    },
  };
}

/** Exact files the owner asked to add. Served only to this Mac, never copied into dist or exposed on LAN. */
function requestedLocalBooks(): Plugin {
  const books = [
    { id: 'huozhe', name: '活着.epub', path: join(homedir(), 'Downloads', '活着.epub') },
    { id: 'shediao', name: '射雕英雄传.epub', path: join(homedir(), 'Downloads', '射雕英雄传.epub') },
  ];
  const install = (server: { middlewares: { use: (handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const route = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (!route.startsWith('/api/local-books')) { next(); return; }
      if (!trustedRequest(req)) { res.writeHead(403).end(); return; }
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      res.setHeader('Cache-Control', 'no-store');
      if (route === '/api/local-books') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(books.filter(b => existsSync(b.path)).map(b => ({ id: b.id, name: b.name }))));
        return;
      }
      const book = books.find(b => route === `/api/local-books/${b.id}`);
      if (!book || !existsSync(book.path)) { res.writeHead(404).end(); return; }
      const size = statSync(book.path).size;
      res.setHeader('Content-Type', 'application/epub+zip');
      res.setHeader('Content-Length', size);
      createReadStream(book.path).on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); }).pipe(res);
    });
  };
  return {
    name: 'dushu-requested-local-books',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default defineConfig({
  base: './',
  plugins: [privateGateway(), woff2Only(), serviceWorker(), requestedLocalBooks(), nativeSpeech(), localModelBridge()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
  server: { port: 5173, allowedHosts: [privateAccess()?.host.split(':')[0] ?? 'localhost'] },
  preview: { allowedHosts: [privateAccess()?.host.split(':')[0] ?? 'localhost'] },
  // Pre-bundle the lazily imported packages so the dev server does not reload the page when it first meets them.
  optimizeDeps: { include: ['hanzi-writer', 'pdfjs-dist', '@anthropic-ai/sdk', 'fflate'] },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    setupFiles: ['tests/setup/wait.ts'],
  },
});
