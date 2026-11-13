// The build step that fills sw.js (serviceWorker() in vite.config.ts), run on a small fake build folder.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// The config reads this machine's private iPad setup when it loads; a test never should.
vi.mock('../../scripts/private-access', async (original) => ({ ...(await original<typeof import('../../scripts/private-access')>()), privateAccess: () => null }));
const { serviceWorker } = await import('../../vite.config');

const root = join(__dirname, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'dushu-precache-'));
afterAll(() => { if (tmp.length > 8) rmSync(tmp, { recursive: true, force: true }); });
const dist = join(tmp, 'dist');

const FILES: Record<string, string> = {
  'assets/index-AbCd1234.js': 'app',
  'assets/index-AbCd1234.css': 'css',
  'assets/fonts-Zx12Cv34.css': '@font-face{font-family:"Noto Serif SC";src:url(data:font/woff2;base64,AAAA) format("woff2")}',
  'assets/pdf.worker.min-yatZIOMy.mjs': 'worker',
  'assets/pdf.worker.min-DgRcL-GR.js': 'shim',
  'assets/GBK-EUC-H-Xy12Ab34.bcmap': 'cmap',
  'assets/pengu-blink-Ab12Cd34.webp': 'frame',
  'assets/noto-serif-sc-0-400-normal-Qw12Er34.woff2': 'slice',
  'data/cedict.tsv.gz': 'dictionary',
  'data/names.tsv.gz': 'names',
  'data/es/entries.tsv.gz': 'palabras',
  'data/es/meta.json': '{}',
  'data/ja/jmdict.tsv.gz': '辞書',
  'data/ja/kuromoji/base.dat.gz': 'base',
  'samples/es/index.json': '[]',
  'samples/index.json': '[]',
  'samples/tang-poems.txt': '靜夜思　李白',
  'samples/hongloumeng.txt': '红'.repeat(100_000),
  'fonts/newsreader-roman.woff2': 'font',
  'fonts/jigmo/Jigmo.woff2': 'rare',
  'icon.svg': '<svg/>',
};
const write = (rel: string, body: string) => { mkdirSync(dirname(join(dist, rel)), { recursive: true }); writeFileSync(join(dist, rel), body); };
for (const [rel, body] of Object.entries(FILES)) write(rel, body);

/** Runs the plugin on the fake build, from a fresh copy of the sw.js template, and reads back what it filled in. */
function build(): { dataVersion: string; shell: string[]; zh: string[]; fontSheets: string[]; precache: string[] } {
  copyFileSync(join(root, 'public/sw.js'), join(dist, 'sw.js'));
  const plugin = serviceWorker() as unknown as { configResolved(c: unknown): void; closeBundle(): void };
  plugin.configResolved({ root: tmp, build: { outDir: 'dist' } });
  plugin.closeBundle();
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
  const list = (name: string) => JSON.parse(new RegExp(`const ${name} = (\\[.*\\]);`).exec(sw)![1]) as string[];
  const [shell, zh, fontSheets] = [list('SHELL'), list('ZH_STATIC'), list('FONT_SHEETS')];
  return { dataVersion: /const DATA_VERSION = '([^']+)'/.exec(sw)![1], shell, zh, fontSheets, precache: [...shell, ...zh] };
}

describe('sw.js precache list', () => {
  it('holds the PDF worker and the Chinese CMaps, so a PDF imports offline; font slices are left to first use', () => {
    const { precache } = build();
    expect(precache).toContain('assets/pdf.worker.min-yatZIOMy.mjs');
    expect(precache).toContain('assets/pdf.worker.min-DgRcL-GR.js');
    expect(precache).toContain('assets/GBK-EUC-H-Xy12Ab34.bcmap');
    expect(precache).toContain('assets/index-AbCd1234.js');
    expect(precache.some((p) => p.endsWith('.woff2') && p.startsWith('assets/'))).toBe(false);
  });

  it('holds the images the code imports, so a Pengu frame first drawn offline (a blink, a jump) is there', () => {
    expect(build().shell).toContain('assets/pengu-blink-Ab12Cd34.webp');
  });

  it('holds the short classics but not the long novels, which are stored when first added', () => {
    const { precache } = build();
    expect(precache).toContain('samples/index.json');
    expect(precache).toContain('samples/tang-poems.txt');
    expect(precache).not.toContain('samples/hongloumeng.txt');
  });
});

describe('sw.js precache lists', () => {
  it('splits the app shell, for every device, from the Chinese dictionary and classics, for a device that reads Chinese', () => {
    const { shell, zh } = build();
    expect(shell).toEqual(expect.arrayContaining(['assets/index-AbCd1234.js', 'icon.svg', 'manifest.webmanifest']));
    expect(shell.some((p) => /^(data|samples)\//.test(p))).toBe(false);
    expect(zh).toEqual(expect.arrayContaining(['data/cedict.tsv.gz', 'samples/tang-poems.txt']));
    expect(zh.every((p) => /^(data|samples)\//.test(p))).toBe(true);
    // Another language's folder is never precached: the page hands over what it downloaded.
    expect(zh.some((p) => /^(data|samples)\/(es|ja)\//.test(p))).toBe(false);
    // Nor are the name list and model, which only name detection fetches.
    expect(zh).not.toContain('data/names.tsv.gz');
  });

  it('leaves the reading fonts\' rules (500 KB) out of the shell: a device whose page loads them keeps them', () => {
    const { shell, fontSheets } = build();
    expect(fontSheets).toEqual(['assets/fonts-Zx12Cv34.css']);
    expect(shell).not.toContain('assets/fonts-Zx12Cv34.css');
    expect(shell).toContain('assets/index-AbCd1234.css');
  });

  it('writes each dictionary folder its sizes, so the reader has the whole total before the first byte', () => {
    build();
    const sizes = (dir: string) => JSON.parse(readFileSync(join(dist, dir, 'sizes.json'), 'utf8')) as Record<string, number>;
    expect(sizes('data')).toMatchObject({ 'cedict.tsv.gz': Buffer.byteLength(FILES['data/cedict.tsv.gz']) });
    expect(Object.keys(sizes('data')).some((f) => f.includes('/'))).toBe(false);
    expect(sizes('data/es')).toEqual({ 'entries.tsv.gz': Buffer.byteLength('palabras'), 'meta.json': 2 });
    // Japanese keeps its tokenizer's files in a folder: the engine asks for them by that path.
    expect(sizes('data/ja')).toEqual({ 'jmdict.tsv.gz': Buffer.byteLength('辞書'), 'kuromoji/base.dat.gz': 4 });
  });
});

describe('sw.js data version', () => {
  const base = build().dataVersion;

  it('is the same for the same files', () => {
    expect(build().dataVersion).toBe(base);
  });

  // Each case is a release that changes only that file, keeping its size: the old version counted sizes of data/ only.
  for (const [rel, body] of [
    ['samples/tang-poems.txt', '靜夜詩　李白'],
    ['data/cedict.tsv.gz', 'Dictionary'],
    ['fonts/newsreader-roman.woff2', 'FONT'],
    ['fonts/jigmo/Jigmo.woff2', 'RARE'],
  ] as const) {
    it(`changes when only ${rel} changes`, () => {
      expect(Buffer.byteLength(body)).toBe(Buffer.byteLength(FILES[rel]));
      write(rel, body);
      try {
        expect(build().dataVersion).not.toBe(base);
      } finally {
        write(rel, FILES[rel]);
      }
      expect(build().dataVersion).toBe(base);
    });
  }
});
