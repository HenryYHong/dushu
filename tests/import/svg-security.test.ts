// @vitest-environment jsdom
// An SVG from a book must never be stored as SVG: opened as its own page (right-click, "open image in new tab",
// long-press on iPad) its script would run with the app's origin. Only raster images are kept, typed by their bytes.
import { strToU8 } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { importFile, importText } from '../../src/import';
import { AssetStore, setDefaultSvgRasterizer } from '../../src/import/assets';
import { looksLikeSvg, sniffRaster } from '../../src/import/imageType';
import { CONTAINER, PNG, asFile, makeEpub, opf, prose, xhtml } from './helpers';

const EVIL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" onload="window.__pwned=1"><script>window.__pwned=2</script>' +
  '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml" onload="window.__pwned=3"/></foreignObject></svg>';

/** Stands in for the browser's canvas: returns a real PNG for any SVG it is given. */
const fakeRasterizer = async () => PNG;

afterEach(() => setDefaultSvgRasterizer());

const bytesOf = (b: Blob) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });

function epubWith(manifestSvgType: string, extra: Record<string, string | Uint8Array> = {}, body = '') {
  return makeEpub({
    'META-INF/container.xml': CONTAINER('content.opf'),
    'content.opf': opf({
      title: '图',
      manifest: [
        ['cov', 'cover.svg', manifestSvgType, 'cover-image'],
        ['img', 'pic.svg', manifestSvgType],
        ['a', 'a.xhtml', 'application/xhtml+xml'],
      ],
      spine: ['a'],
    }),
    'cover.svg': EVIL_SVG,
    'pic.svg': EVIL_SVG,
    'a.xhtml': xhtml(`<p>${prose(40)}</p><p><img src="pic.svg" alt="x"/></p>${body}`),
    ...extra,
  });
}

describe('image sniffing', () => {
  it('recognizes raster formats by their bytes and not SVG', () => {
    expect(sniffRaster(PNG)?.mime).toBe('image/png');
    expect(sniffRaster(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]))?.mime).toBe('image/jpeg');
    expect(sniffRaster(strToU8('GIF89a\u0001\u0000\u0001\u0000\u0000\u0000'))?.mime).toBe('image/gif');
    expect(sniffRaster(strToU8('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))?.mime).toBe('image/webp');
    expect(sniffRaster(strToU8('\u0000\u0000\u0000\u001cftypavif\u0000\u0000\u0000\u0000'))?.mime).toBe('image/avif');
    expect(sniffRaster(strToU8(EVIL_SVG))).toBeUndefined();
    expect(sniffRaster(strToU8('<html><script>alert(1)</script></html>'))).toBeUndefined();
    expect(looksLikeSvg(strToU8(EVIL_SVG))).toBe(true);
    expect(looksLikeSvg(strToU8('<?xml version="1.0"?><!-- c --><SVG viewBox="0 0 1 1"/>'))).toBe(true);
    expect(looksLikeSvg(strToU8('<p>hello</p>'))).toBe(false);
  });
});

describe('EPUB SVG images', () => {
  it('converts a manifest SVG (cover and inline) to PNG and stores no SVG', async () => {
    setDefaultSvgRasterizer(fakeRasterizer);
    const book = await importFile(asFile(epubWith('image/svg+xml'), 'svg.epub'));
    expect(book.assets.size).toBeGreaterThan(0);
    for (const [name, blob] of book.assets) {
      expect(blob.type, name).toBe('image/png');
      expect(sniffRaster(await bytesOf(blob))?.mime).toBe('image/png');
      expect(new TextDecoder().decode(await bytesOf(blob))).not.toContain('<script');
    }
    const img = book.chapters.flatMap((c) => c.blocks).find((b) => b.t === 'img') as { asset: string };
    expect(img.asset).toMatch(/\.png$/);
    expect(book.assets.has(img.asset)).toBe(true);
    expect(book.cover && book.assets.has(book.cover)).toBe(true);
  });

  it('drops the image blocks and the cover when an SVG cannot be converted', async () => {
    setDefaultSvgRasterizer(async () => null);
    const book = await importFile(asFile(epubWith('image/svg+xml'), 'svg.epub'));
    expect(book.assets.size).toBe(0);
    expect(book.cover).toBeUndefined();
    expect(book.chapters.flatMap((c) => c.blocks).some((b) => b.t === 'img')).toBe(false);
    expect(book.chapters.length).toBeGreaterThan(0);
  });

  it('never stores what a rasterizer returns unless it is a PNG', async () => {
    setDefaultSvgRasterizer(async (svg) => svg); // hands the SVG straight back
    const book = await importFile(asFile(epubWith('image/svg+xml'), 'svg.epub'));
    expect(book.assets.size).toBe(0);
  });

  it('does not trust a declared PNG type on SVG bytes', async () => {
    setDefaultSvgRasterizer(async () => null);
    const book = await importFile(asFile(epubWith('image/png'), 'lie.epub'));
    for (const blob of book.assets.values()) expect(blob.type).not.toMatch(/svg/);
    expect(book.assets.size).toBe(0);
  });

  it('types a PNG by its bytes whatever the manifest says', async () => {
    const book = await importFile(
      asFile(
        makeEpub({
          'META-INF/container.xml': CONTAINER('content.opf'),
          'content.opf': opf({ title: '图', manifest: [['i', 'p.svg', 'image/svg+xml', 'cover-image'], ['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
          'p.svg': PNG,
          'a.xhtml': xhtml(`<p>${prose(40)}</p><p><img src="p.svg"/></p>`),
        }),
        'png-as-svg.epub',
      ),
    );
    expect([...book.assets.values()].map((b) => b.type)).toEqual(['image/png']);
    expect([...book.assets.keys()][0]).toMatch(/\.png$/);
  });

  it('drops files that are not images at all, even when labelled image/png', async () => {
    const book = await importFile(
      asFile(
        makeEpub({
          'META-INF/container.xml': CONTAINER('content.opf'),
          'content.opf': opf({ title: '图', manifest: [['i', 'p.png', 'image/png', 'cover-image'], ['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
          'p.png': '<html><script>window.__pwned=9</script></html>',
          'a.xhtml': xhtml(`<p>${prose(40)}</p><p><img src="p.png"/></p>`),
        }),
        'html-as-png.epub',
      ),
    );
    expect(book.assets.size).toBe(0);
    expect(book.cover).toBeUndefined();
  });

  it('converts data-URI SVGs (base64 and percent-encoded) like any other', async () => {
    setDefaultSvgRasterizer(fakeRasterizer);
    const b64 = `data:image/svg+xml;base64,${btoa(EVIL_SVG)}`;
    const pct = `data:image/svg+xml;utf8,${encodeURIComponent(EVIL_SVG.replace('width="40"', 'width="41"') + '图')}`;
    const book = await importFile(asFile(epubWith('image/png', {}, `<p><img src="${b64}"/><img src="${pct}"/></p>`), 'data.epub'));
    for (const blob of book.assets.values()) expect(blob.type).toBe('image/png');
    const imgs = book.chapters.flatMap((c) => c.blocks).filter((b) => b.t === 'img') as { asset: string }[];
    expect(imgs.length).toBeGreaterThanOrEqual(2);
    for (const i of imgs) expect(book.assets.has(i.asset)).toBe(true);
  });
});

describe('HTML SVG images', () => {
  it('converts or drops a data-URI SVG in an HTML page', async () => {
    const html = `<html><head><title>页</title></head><body><p>${prose(60)}</p><img src="data:image/svg+xml;base64,${btoa(EVIL_SVG)}"/></body></html>`;
    setDefaultSvgRasterizer(fakeRasterizer);
    const kept = await importFile(asFile(strToU8(html), 'page.html'));
    expect([...kept.assets.values()].map((b) => b.type)).toEqual(['image/png']);
    setDefaultSvgRasterizer(async () => null);
    const dropped = await importFile(asFile(strToU8(html), 'page.html'));
    expect(dropped.assets.size).toBe(0);
    expect(dropped.chapters.flatMap((c) => c.blocks).some((b) => b.t === 'img')).toBe(false);
  });
});

describe('AssetStore', () => {
  it('does not mix up two different data URIs that end alike', () => {
    const store = new AssetStore(async () => PNG);
    const a = Uint8Array.from([...PNG, 1]);
    const b = Uint8Array.from([...PNG, 2]);
    const na = store.addDataUri(`data:image/png;base64,${btoa(String.fromCharCode(...a))}`);
    const nb = store.addDataUri(`data:image/png;base64,${btoa(String.fromCharCode(...b))}`);
    expect(na).toBeDefined();
    expect(nb).toBeDefined();
    expect(na).not.toBe(nb);
  });

  it('skips pasted text with no images and keeps the contract for importText', () => {
    expect(importText(prose(60)).assets.size).toBe(0);
  });
});
