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
  'assets/pdf.worker.min-yatZIOMy.mjs': 'worker',
  'assets/pdf.worker.min-DgRcL-GR.js': 'shim',
  'assets/GBK-EUC-H-Xy12Ab34.bcmap': 'cmap',
  'assets/noto-serif-sc-0-400-normal-Qw12Er34.woff2': 'slice',
  'data/cedict.tsv.gz': 'dictionary',
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
function build(): { dataVersion: string; precache: string[] } {
  copyFileSync(join(root, 'public/sw.js'), join(dist, 'sw.js'));
  const plugin = serviceWorker() as unknown as { configResolved(c: unknown): void; closeBundle(): void };
  plugin.configResolved({ root: tmp, build: { outDir: 'dist' } });
  plugin.closeBundle();
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
  return { dataVersion: /const DATA_VERSION = '([^']+)'/.exec(sw)![1], precache: JSON.parse(/const PRECACHE = (\[.*\]);/.exec(sw)![1]) };
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

  it('holds the short classics but not the long novels, which are stored when first added', () => {
    const { precache } = build();
    expect(precache).toContain('samples/index.json');
    expect(precache).toContain('samples/tang-poems.txt');
    expect(precache).not.toContain('samples/hongloumeng.txt');
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
