import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { SIZES_FILE } from './src/core/dataFetch';
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
export function contentVersion(dist: string, dirs: string[], skip: (path: string) => boolean = () => false): string {
  const hash = createHash('sha1');
  for (const dir of dirs) {
    const root = join(dist, dir);
    if (!existsSync(root)) continue;
    const files = (readdirSync(root, { recursive: true }) as string[]).map((f) => f.split(sep).join('/')).sort();
    for (const f of files) {
      if (skip(`${dir}/${f}`) || !statSync(join(root, f)).isFile()) continue;
      hash.update(`${dir}/${f}\0`).update(readFileSync(join(root, f))).update('\0');
    }
  }
  return hash.digest('hex').slice(0, 10);
}

/** The languages other than Chinese, whose data (data/<id>/) and classics (samples/<id>/) have caches of their own. */
export const OTHER_LANGS = ['ja', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'en'];
const LANG_PATH = new RegExp(`^(?:data|samples)/(?:${OTHER_LANGS.join('|')})/`);

/** Chinese data files that are not precached: each is stored the first time the app fetches it. */
export const LAZY_DATA = new Set(['names.tsv.gz', 'name-model.tsv.gz', 'native.tsv.gz']);

/** The largest classic downloaded ahead on a first visit, in bytes; longer ones are stored when first added. */
export const SAMPLE_PRECACHE_MAX = 256 * 1024;

/**
 * A stylesheet of @font-face rules only: the reading fonts' (fonts.ts, 500 KB). It is not in the shell every device precaches,
 * since only the libraries that show Chinese or Japanese load it (sw.js FONT_SHEETS).
 */
export function onlyFontFaces(css: string): boolean {
  return /@font-face/.test(css) && css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/g, '').trim() === '';
}

/**
 * Writes each dictionary folder's file sizes into it (data/sizes.json for Chinese, data/<id>/sizes.json for the rest, with
 * their subfolders: 'kuromoji/base.dat.gz'), so the reader's "Downloading the dictionary: x of y MB" has the whole total
 * before the first byte arrives (core/dataFetch.ts byteMeter).
 */
export function writeDataSizes(dist: string): void {
  const write = (dir: string, recursive: boolean) => {
    const sizes: Record<string, number> = {};
    const names = (readdirSync(dir, { recursive }) as string[]).map((f) => f.split(sep).join('/')).sort();
    for (const f of names) {
      if (f === SIZES_FILE || !statSync(join(dir, f)).isFile()) continue;
      sizes[f] = statSync(join(dir, f)).size;
    }
    writeFileSync(join(dir, SIZES_FILE), JSON.stringify(sizes));
  };
  const data = join(dist, 'data');
  if (!existsSync(data)) return;
  write(data, false);
  for (const id of OTHER_LANGS) if (existsSync(join(data, id))) write(join(data, id), true);
}

/**
 * Fills the placeholders in the built sw.js: a build id, the data version, and the files to precache. The app shell goes on
 * every device. The Chinese dictionary and short classics go only on a device that reads Chinese: sw.js precaches them when
 * the page handed the Chinese dictionary over on a first visit, or the previous offline copy kept it.
 */
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
      writeDataSizes(dist);
      // Font slices are not precached: the ones a book uses are cached the first time they are fetched. Nor are the reading
      // fonts' rules (fontSheets), which a device keeps once its page has loaded them. The PDF worker
      // (1.4 MB) and the Chinese CMaps (0.8 MB) are, so a PDF imports offline; sw.js copies unchanged hashed files from the
      // previous build's cache, so an update does not download them again.
      // The images the code imports (Pengu's frames, 130 KB): a frame first drawn offline (a jump, a blink) must be stored already.
      const assets = readdirSync(join(dist, 'assets')).filter((f) => /\.(js|mjs|css|bcmap|webp|png|jpe?g|gif|svg)$/.test(f));
      // Chinese data only: another language's folder is a directory here, and it is never downloaded ahead (on a first visit
      // the page hands the files it downloaded over; otherwise each is stored the first time that language is opened, in a
      // cache of its own named by its own contents, so a Chinese update keeps it).
      // (The name list, names.tsv.gz, and the name model are not fetched ahead either: only name detection needs them, and they are
      // stored the first time.)
      const data = readdirSync(join(dist, 'data')).filter((f) => statSync(join(dist, 'data', f)).isFile() && !LAZY_DATA.has(f));
      const build = createHash('sha1').update(assets.join('|')).digest('hex').slice(0, 10);
      const dataVersion = contentVersion(dist, ['data', 'samples', 'fonts'], (p) => LANG_PATH.test(p));
      const langVersions: Record<string, string> = {};
      for (const id of OTHER_LANGS) {
        if (existsSync(join(dist, 'data', id)) || existsSync(join(dist, 'samples', id))) langVersions[id] = contentVersion(dist, [`data/${id}`, `samples/${id}`]);
      }
      const icons = existsSync(join(dist, 'icons')) ? readdirSync(join(dist, 'icons')).map((f) => `icons/${f}`) : [];
      // The short classics (and their index) are fetched ahead too, so adding one works without a connection. The long
      // novels (about 4 MB together over the wire) are not: each is stored the first time someone adds it.
      const samples = existsSync(join(dist, 'samples'))
        ? readdirSync(join(dist, 'samples')).filter((f) => /\.(?:txt|json)$/.test(f) && statSync(join(dist, 'samples', f)).size <= SAMPLE_PRECACHE_MAX).map((f) => `samples/${f}`)
        : [];
      const fontSheets = assets.filter((f) => f.endsWith('.css') && onlyFontFaces(readFileSync(join(dist, 'assets', f), 'utf8'))).map((f) => `assets/${f}`);
      const shell = [...assets.map((f) => `assets/${f}`).filter((p) => !fontSheets.includes(p)), 'icon.svg', 'manifest.webmanifest', ...icons];
      const zhStatic = [...data.map((f) => `data/${f}`), ...samples];
      // Each stored file's content fingerprint (data/, samples/, fonts/): an update copies the files it did not change from the
      // old cache instead of downloading them again (GitHub Pages' ETags change with every deploy), sw.js install.
      const hashes: Record<string, string> = {};
      for (const dir of ['data', 'samples', 'fonts']) {
        const root = join(dist, dir);
        if (!existsSync(root)) continue;
        for (const f of (readdirSync(root, { recursive: true }) as string[]).map((x) => x.split(sep).join('/')).sort()) {
          if (statSync(join(root, f)).isFile()) hashes[`${dir}/${f}`] = createHash('sha1').update(readFileSync(join(root, f))).digest('hex').slice(0, 12);
        }
      }
      writeFileSync(join(dist, 'content-hashes.json'), JSON.stringify(hashes));
      writeFileSync(swPath, readFileSync(swPath, 'utf8')
        .replace('__BUILD__', build).replace('__DATA_VERSION__', dataVersion)
        .replace('__SHELL__', JSON.stringify(shell)).replace('__ZH_STATIC__', JSON.stringify(zhStatic)).replace('__FONT_SHEETS__', JSON.stringify(fontSheets))
        .replace('__LANG_VERSIONS__', JSON.stringify(langVersions)));
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
