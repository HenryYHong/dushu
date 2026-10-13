// EPUB 2 and 3: zip, package document, spine, table of contents, content to blocks, cover.
import type { Block, Chapter, ImportedBook } from '../types';
import { AssetStore, dropAssets } from './assets';
import { extractBlocks } from './blocks';
import { finalizeChapters, stripGutenberg } from './chapters';
import { decodeText, sniffMarkupCharset } from './encoding';
import { ImportError } from './errors';
import { Archive, ZIP_LIMITS } from './zip';
import { attr, byLocal, childrenByLocal, dirname, fragmentOf, localName, parseXhtml, parseXmlLoose, plainText, resolvePath } from './markup';
import { cleanAuthors, cleanTitle, parseFilename } from './meta';
import { chaptersFromSpine, dropTitlePage, type SpineDoc, type TocRef } from './spine';

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string[];
}

interface TocEntry {
  title: string;
  path: string;
  frag: string;
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const FONT_ALGORITHMS = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#rc'];
const DRM_MESSAGE =
  'This EPUB is protected by DRM (copy protection), so Dushu cannot read it. Use a DRM-free copy of the book, or one you have the right to convert.';

const utf8 = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);
const extOf = (p: string) => (/\.([A-Za-z0-9]+)$/.exec(p)?.[1] ?? '').toLowerCase();
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function decodeMarkup(bytes: Uint8Array): string {
  return decodeText(bytes, sniffMarkupCharset(bytes)).text;
}

/** Throw if the book is encrypted with anything other than font obfuscation. */
function assertNotDrm(archive: Archive): void {
  const bytes = archive.get('META-INF/encryption.xml');
  if (!bytes) return;
  const doc = parseXmlLoose(utf8(bytes));
  for (const ed of byLocal(doc, 'encrypteddata')) {
    const algorithm = attr(byLocal(ed, 'encryptionmethod')[0] ?? ed, 'algorithm').toLowerCase();
    const uri = attr(byLocal(ed, 'cipherreference')[0] ?? ed, 'uri');
    const fontFile = /\.(?:otf|ttf|ttc|woff2?)$/i.test(uri);
    if (!FONT_ALGORITHMS.includes(algorithm) && !fontFile) throw new ImportError(DRM_MESSAGE);
  }
}

function findOpf(archive: Archive): string {
  const container = archive.get('META-INF/container.xml');
  if (container) {
    const doc = parseXmlLoose(utf8(container));
    const roots = byLocal(doc, 'rootfile');
    const root = roots.find((r) => /oebps-package/.test(attr(r, 'media-type'))) ?? roots[0];
    const path = root ? attr(root, 'full-path') : '';
    if (path) return resolvePath('', path);
  }
  const opf = archive.names().find((k) => k.toLowerCase().endsWith('.opf'));
  if (!opf) {
    if (archive.has('word/document.xml')) throw new ImportError('Word documents are not supported. Save the document as a text file or PDF, then import that.');
    throw new ImportError('This zip archive is not an EPUB (no package document found).');
  }
  return opf;
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function readToc(
  getText: (path: string) => string | undefined,
  manifest: ManifestItem[],
  opf: Document,
): TocEntry[] {
  const fromNav = (item: ManifestItem): TocEntry[] => {
    const text = getText(item.path);
    if (!text) return [];
    const doc = parseXhtml(text);
    const navs = byLocal(doc, 'nav');
    const nav =
      navs.find((n) => /\btoc\b/.test(attr(n, 'type'))) ??
      navs.find((n) => !/landmarks|page-list/.test(attr(n, 'type'))) ??
      navs[0];
    const root = nav ? byLocal(nav, 'ol')[0] : byLocal(doc, 'ol')[0];
    const out: TocEntry[] = [];
    const walkList = (ol: Element) => {
      for (const li of childrenByLocal(ol, 'li')) {
        const a = childrenByLocal(li, 'a')[0] ?? childrenByLocal(li, 'span')[0];
        const href = a && localName(a) === 'a' ? attr(a, 'href') : '';
        if (a && href) out.push({ title: plainText(a), path: resolvePath(item.path, href), frag: fragmentOf(href) });
        for (const sub of childrenByLocal(li, 'ol')) walkList(sub);
      }
    };
    if (root) walkList(root);
    return out;
  };

  const fromNcx = (item: ManifestItem): TocEntry[] => {
    const text = getText(item.path);
    if (!text) return [];
    const doc = parseXmlLoose(text);
    const out: TocEntry[] = [];
    for (const np of byLocal(doc, 'navpoint')) {
      const label = byLocal(childrenByLocal(np, 'navlabel')[0] ?? np, 'text')[0];
      const content = childrenByLocal(np, 'content')[0];
      const src = content ? attr(content, 'src') : '';
      if (src) out.push({ title: label ? plainText(label) : '', path: resolvePath(item.path, src), frag: fragmentOf(src) });
    }
    return out;
  };

  const navItem = manifest.find((m) => m.properties.includes('nav'));
  if (navItem) {
    const entries = fromNav(navItem);
    if (entries.length) return entries;
  }
  const spineToc = byLocal(opf, 'spine')[0]?.getAttribute('toc') ?? '';
  const ncxItem = manifest.find((m) => m.id === spineToc) ?? manifest.find((m) => m.mediaType === 'application/x-dtbncx+xml' || extOf(m.path) === 'ncx');
  return ncxItem ? fromNcx(ncxItem) : [];
}

export async function importEpub(data: Uint8Array, sourceName: string, onProgress?: (fraction: number) => void): Promise<ImportedBook> {
  // List the archive first (declared sizes are checked there), then inflate only what the book needs.
  const archive = new Archive(data);
  const textMax = ZIP_LIMITS.textBytes;
  archive.inflate(['META-INF/container.xml', 'META-INF/encryption.xml'], { maxBytes: textMax });
  if (!archive.has('META-INF/container.xml')) archive.inflate(archive.names().filter((k) => k.toLowerCase().endsWith('.opf')).slice(0, 4), { maxBytes: textMax });
  assertNotDrm(archive);
  onProgress?.(0.05);

  const getFile = (path: string): Uint8Array | undefined => archive.get(path);
  const getText = (path: string): string | undefined => {
    const b = getFile(path);
    return b ? decodeMarkup(b) : undefined;
  };

  // ---- package document
  const opfPath = findOpf(archive);
  archive.inflate([opfPath], { maxBytes: textMax });
  const opfText = getText(opfPath);
  if (!opfText) throw new ImportError('This EPUB is damaged: its package document is missing.');
  const opf = parseXmlLoose(opfText);

  const manifest: ManifestItem[] = byLocal(opf, 'item')
    .filter((el) => localName(el.parentElement ?? el) === 'manifest')
    .map((el) => ({
      id: el.getAttribute('id') ?? '',
      path: resolvePath(opfPath, attr(el, 'href')),
      mediaType: attr(el, 'media-type').toLowerCase(),
      properties: attr(el, 'properties').split(/\s+/).filter(Boolean),
    }));
  const byId = new Map(manifest.map((m) => [m.id, m]));
  const isImagePath = (path: string) => IMAGE_EXT.has(extOf(path));
  // Inflate what the package lists, plus any image file (some books use pictures their manifest forgot). Other
  // entries (fonts, audio, stray files) are never inflated. A picture over the size cap is skipped, not fatal.
  archive.inflate(manifest.filter((m) => !m.mediaType.startsWith('image/') && !isImagePath(m.path)).map((m) => m.path), { maxBytes: textMax });
  archive.inflate(
    [...manifest.filter((m) => m.mediaType.startsWith('image/') || isImagePath(m.path)).map((m) => m.path), ...archive.names().filter(isImagePath)],
    { maxBytes: ZIP_LIMITS.imageBytes, skipLarge: true },
  );

  let spine: ManifestItem[] = byLocal(opf, 'itemref')
    .map((el) => byId.get(el.getAttribute('idref') ?? ''))
    .filter((m): m is ManifestItem => !!m);
  if (!spine.length) {
    // No usable spine: read every markup file in name order.
    const loose = archive.names().filter((k) => /\.(?:x?html?)$/i.test(k) && !/^META-INF\//.test(k));
    archive.inflate(loose, { maxBytes: textMax });
    spine = loose
      .sort(naturalCompare)
      .map((path) => ({ id: path, path, mediaType: 'application/xhtml+xml', properties: [] }));
  }
  if (!spine.length) throw new ImportError('This EPUB has no readable content.');

  // ---- assets
  const store = new AssetStore();
  const registerAsset = (path: string): string | undefined => {
    const bytes = getFile(path);
    if (!bytes) return undefined;
    // The type comes from the bytes (assets.ts); what the manifest or extension says is not trusted.
    return store.add(path, path.split('/').pop() ?? 'image', bytes);
  };

  // ---- table of contents
  const toc = readToc(getText, manifest, opf);
  const tocPaths = new Set(toc.map((e) => e.path));
  const navPaths = new Set(manifest.filter((m) => m.properties.includes('nav')).map((m) => m.path));

  // ---- content
  const docs: SpineDoc[] = [];
  let lastYield = Date.now();
  for (let i = 0; i < spine.length; i++) {
    const item = spine[i];
    const bytes = getFile(item.path);
    const doc: SpineDoc = { path: item.path, blocks: [], anchors: new Map(), skipped: false };
    docs.push(doc);
    if (!bytes || navPaths.has(item.path)) {
      doc.skipped = true;
      continue;
    }
    if (item.mediaType.startsWith('image/')) {
      const asset = registerAsset(item.path);
      if (asset) doc.blocks.push({ t: 'img', asset });
      continue;
    }
    const markup = parseXhtml(decodeMarkup(bytes));
    const extracted = extractBlocks(markup, {
      resolveImage: (src) => {
        if (/^data:/i.test(src)) return store.addDataUri(src);
        if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return undefined;
        return registerAsset(resolvePath(item.path, src));
      },
    });
    if (extracted.linkCount >= 3 && extracted.linkShare > 0.7 && !tocPaths.has(item.path)) {
      doc.skipped = true; // a generated contents page
    } else {
      doc.blocks = extracted.blocks;
      doc.anchors = extracted.anchors;
    }
    onProgress?.(0.05 + 0.85 * ((i + 1) / spine.length));
    if (Date.now() - lastYield > 30) {
      await tick();
      lastYield = Date.now();
    }
  }

  // ---- chapters
  const indexByPath = new Map<string, number>();
  docs.forEach((d, i) => {
    if (!indexByPath.has(d.path)) indexByPath.set(d.path, i);
  });
  const refs: TocRef[] = [];
  for (const e of toc) {
    const doc = indexByPath.get(e.path);
    if (doc !== undefined) refs.push({ doc, frag: e.frag, title: e.title });
  }
  const chapters = chaptersFromSpine(docs, refs);

  // ---- metadata
  const dc = (name: string) => byLocal(opf, name).filter((el) => localName(el.parentElement ?? el) === 'metadata');
  const roleOf = (el: Element): string => {
    const own = attr(el, 'role');
    if (own) return own.toLowerCase();
    const id = el.getAttribute('id');
    if (!id) return '';
    const refine = byLocal(opf, 'meta').find((m) => m.getAttribute('refines') === `#${id}` && attr(m, 'property') === 'role');
    return (refine?.textContent ?? '').trim().toLowerCase();
  };
  const creators = dc('creator');
  const authorsOnly = creators.filter((c) => roleOf(c) === 'aut');
  const authorList = (authorsOnly.length ? authorsOnly : creators.filter((c) => !roleOf(c) || roleOf(c) === 'aut')).map((c) => plainText(c));
  const fromFile = parseFilename(sourceName);
  const title = cleanTitle(dc('title').map((t) => plainText(t)).find(Boolean) ?? '') || fromFile.title || 'Untitled';
  const author = cleanAuthors(authorList);

  const coverName = findCover(opf, opfPath, manifest, byId, getText, registerAsset);

  // SVG images become PNG here; any that cannot be converted are removed from the text and the cover.
  const dropped = await store.finalize();
  const kept = dropAssets(dropTitlePage(finalizeChapters(stripGutenberg(chapters, title)), title, author), coverName, dropped);

  onProgress?.(0.97);
  return {
    title,
    author,
    format: 'epub',
    script: 'unknown',
    chapters: kept.chapters,
    assets: store.assets,
    cover: kept.cover,
    sourceName,
  };
}

function findCover(
  opf: Document,
  opfPath: string,
  manifest: ManifestItem[],
  byId: Map<string, ManifestItem>,
  getText: (path: string) => string | undefined,
  register: (path: string) => string | undefined,
): string | undefined {
  const fromItem = (item: ManifestItem | undefined): string | undefined => {
    if (!item) return undefined;
    if (item.mediaType.startsWith('image/')) return register(item.path);
    const text = getText(item.path);
    if (!text) return undefined;
    const doc = parseXhtml(text);
    for (const el of Array.from(doc.getElementsByTagName('*'))) {
      const n = localName(el);
      if (n === 'img' || n === 'image') {
        const src = attr(el, n === 'img' ? 'src' : 'href');
        if (src && !/^(?:data:|[a-z][a-z0-9+.-]*:)/i.test(src)) return register(resolvePath(item.path, src));
      }
    }
    return undefined;
  };

  const metaCover = byLocal(opf, 'meta').find((m) => m.getAttribute('name') === 'cover');
  const guide = byLocal(opf, 'reference').find((r) => (r.getAttribute('type') ?? '').toLowerCase() === 'cover');
  const guidePath = guide ? resolvePath(opfPath, attr(guide, 'href')) : '';
  const candidates: (ManifestItem | undefined)[] = [
    manifest.find((m) => m.properties.includes('cover-image')),
    metaCover ? byId.get(metaCover.getAttribute('content') ?? '') : undefined,
    guidePath ? manifest.find((m) => m.path === guidePath) : undefined,
    manifest.find((m) => m.mediaType.startsWith('image/') && /cover/i.test(m.id + m.path)),
    manifest.find((m) => m.mediaType.startsWith('image/') && m.mediaType !== 'image/svg+xml'),
    manifest.find((m) => m.mediaType.startsWith('image/')),
  ];
  for (const item of candidates) {
    const found = fromItem(item);
    if (found) return found;
  }
  return undefined;
}
