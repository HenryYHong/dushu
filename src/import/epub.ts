// EPUB 2 and 3: zip, package document, spine, table of contents, content to blocks, cover.
import type { Block, Chapter, ImportedBook } from '../types';
import { AssetStore, dropAssets } from './assets';
import { extractBlocks } from './blocks';
import { chaptersByTextHeadings, finalizeChapters, stripGutenberg } from './chapters';
import { decodeText, sniffMarkupCharset, unreadableMessage, withHongKongCharacters } from './encoding';
import { ImportError } from './errors';
import { Archive, ZIP_LIMITS } from './zip';
import { attr, byLocal, childrenByLocal, dirname, fragmentOf, localName, parseXhtml, parseXmlLoose, plainText, resolvePath } from './markup';
import { cleanAuthors, cleanTitle, parseFilename } from './meta';
import { chaptersFromSpine, dropContentsPages, dropTitlePage, firstHeading, type SpineDoc, type TocRef } from './spine';

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
  'This EPUB is protected by DRM (copy protection), so Globereader cannot read it. Use a DRM-free copy of the book, or one you have the right to convert.';

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

/**
 * Whether a content file of the book is ciphertext, not markup: it does not open with "<" (after a byte-order mark and
 * spaces), and its first bytes hold control characters that no text has (random bytes are about one in nine of them).
 */
export function looksEncrypted(bytes: Uint8Array): boolean {
  if (bytes.length < 64) return false;
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  else if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return false;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0)) i++;
  if (bytes[i] === 0x3c) return false;
  const n = Math.min(bytes.length, 4096);
  let control = 0;
  for (let k = 0; k < n; k++) {
    const b = bytes[k];
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) control++;
  }
  return control > n * 0.03;
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

/** Pictures Wikisource's pages carry that are not the book's: license and project icons, flags, its logo. */
const WIKISOURCE_ICON = /(?:_icon|_logo|Wikisource-logo|Wikimedia|\.svg\.png_utm_source|PD-icon|Flag_of)/i;
/** Wikisource's author namespaces, as its sites in the reading languages name them. */
const WIKISOURCE_AUTHOR = /^(?:Author|Autor|Auteur|Autore|Автор|作者|著者):\s*/;

/**
 * Takes Wikisource's furniture out of one part, before its blocks are made: the header template (headerContainer: the parts
 * before and after, the title, "作者：<author>"), the sister-project list, and anything marked not to print or export. Returns
 * the author the header names, and the part's own title from the header's middle cell when the text does not carry it: 西遊記's
 * "第二回 悟徹菩提真妙理　斷魔歸本合元神" (the work's title, `work`, is left out of it).
 */
export function tidyWikisource(doc: Document, work = ''): { author: string; part: string } {
  let author = '';
  for (const a of doc.querySelectorAll('a[title]')) {
    const t = a.getAttribute('title') ?? '';
    // The page's own name ("Автор:Антон Павлович Чехов"), not the link's words ("автор Антон Павлович Чехов (1860—1904)").
    if (WIKISOURCE_AUTHOR.test(t)) { author = t.replace(WIKISOURCE_AUTHOR, '').replace(/\s*\([^)]*\)\s*$/, '').trim() || (a.textContent ?? '').trim(); break; }
  }
  let part = '';
  const header = doc.querySelector('[id^="headerContainer"]');
  const middle = header ? [...header.querySelectorAll('td')].find((td) => td.querySelector('b')) : undefined;
  if (middle) {
    // Its lines, up to the author's: the work's title in bold, then the part's number and name.
    const lines: string[] = [];
    let line = '';
    for (const node of middle.childNodes) {
      if (node.nodeName.toLowerCase() === 'br') { lines.push(line.trim()); line = ''; continue; }
      const el = node as Element;
      if (el.nodeType === 1 && (el.matches?.('a[title]') && WIKISOURCE_AUTHOR.test(el.getAttribute('title') ?? ''))) break;
      line += node.textContent ?? '';
    }
    lines.push(line.trim());
    const kept = [];
    for (const l of lines) {
      if (/^(?:作者|著者|Author|Autor|Auteur|Autore|Автор)\s*[：:]/.test(l)) break;
      if (l && l !== work.trim()) kept.push(l);
    }
    part = kept.join(' ').replace(/\s+/g, ' ').trim();
  }
  // Each Wikisource names its header its own way: headerContainer (zh, en), navigationHeader and navigationNotes (ja),
  // headertemplate (ru). The printed book's page numbers (ws-pagenum) are not the reader's.
  for (const el of doc.querySelectorAll('[id^="headerContainer"], [id^="navigationHeader"], [id^="navigationNotes"], [id^="headertemplate"], [id^="plainSister"], .noprint, .ws-noexport, .ws-pagenum, .mw-editsection, .ws-summary, .licenseContainer')) el.remove();
  return { author, part };
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
  // Wikisource's own EPUB export (ws-export, used by Find a book): its source is a wikisource.org page. Each part starts with the
  // site's header (the parts before and after, the author) and sister-project links, an English "About this digital edition" page
  // and a title page come with it, the cover is the Wikisource logo, and license icons sit in the text. All of that goes.
  const wikisource = byLocal(opf, 'source').some((el) => /\bwikisource\.org\//i.test(el.textContent ?? ''))
    || byLocal(opf, 'contributor').some((el) => /^\s*wikisource\s*$/i.test(el.textContent ?? ''));
  let wikisourceAuthor = '';
  const workTitle = byLocal(opf, 'title')[0]?.textContent?.trim() ?? '';
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
  const unreadable = { n: 0 };
  let textDocs = 0;
  let encrypted = 0;
  let lastYield = Date.now();
  for (let i = 0; i < spine.length; i++) {
    const item = spine[i];
    const bytes = getFile(item.path);
    const doc: SpineDoc = { path: item.path, blocks: [], anchors: new Map(), skipped: false };
    docs.push(doc);
    if (!bytes || navPaths.has(item.path) || (wikisource && /(?:^|\/)(?:about|title)\.xhtml$/i.test(item.path))) {
      doc.skipped = true;
      continue;
    }
    if (item.mediaType.startsWith('image/')) {
      const asset = registerAsset(item.path);
      if (asset) doc.blocks.push({ t: 'img', asset });
      continue;
    }
    textDocs++;
    if (looksEncrypted(bytes)) {
      encrypted++;
      doc.skipped = true;
      continue;
    }
    const decoded = await withHongKongCharacters(decodeText(bytes, sniffMarkupCharset(bytes)));
    unreadable.n += decoded.unreadable ?? 0;
    const markup = parseXhtml(decoded.text);
    let wikisourcePart = '';
    if (wikisource) {
      const named = tidyWikisource(markup, workTitle);
      wikisourceAuthor ||= named.author;
      wikisourcePart = named.part;
    }
    const extracted = extractBlocks(markup, {
      resolveImage: (src) => {
        if (wikisource && WIKISOURCE_ICON.test(src)) return undefined;
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
      // A Wikisource part whose title was only in the header gets it back as its heading.
      const top = doc.blocks.find((b) => b.t !== 'hr');
      if (wikisourcePart && !(top?.t === 'h' && wikisourcePart.includes(top.text.trim()))) {
        doc.blocks.unshift({ t: 'h', level: 2, text: wikisourcePart });
        for (const [k, v] of doc.anchors) doc.anchors.set(k, v + 1);
      }
    }
    onProgress?.(0.05 + 0.85 * ((i + 1) / spine.length));
    if (Date.now() - lastYield > 30) {
      await tick();
      lastYield = Date.now();
    }
  }

  // A store's book with its encryption.xml stripped (a half-done DRM removal): the chapters are still ciphertext.
  if (encrypted && encrypted * 2 >= textDocs) throw new ImportError(DRM_MESSAGE);

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
  let chapters = chaptersFromSpine(docs, refs);
  // The whole book in one file under one contents entry (a converter's EPUB, the entry often "正文"): its chapters are found in
  // its text, as in a TXT file.
  const content = docs.filter((d) => !d.skipped && d.blocks.some((b) => b.t === 'p' || b.t === 'quote'));
  // Wikisource's contents also list its title and About pages, which are not read: one work on one page is still one file.
  if (content.length === 1 && (refs.length <= 1 || wikisource)) {
    const byText = chaptersByTextHeadings(content[0].blocks, refs[0]?.title ?? '');
    if (byText) chapters = docs.flatMap((d) => (d === content[0] ? byText : !d.skipped && d.blocks.length ? [{ title: firstHeading(d.blocks), blocks: d.blocks }] : []));
  }

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
  const author = cleanAuthors(authorList.length ? authorList : wikisourceAuthor ? [wikisourceAuthor] : []);

  // Wikisource's cover is its own logo: the app draws a cover instead.
  const coverName = wikisource ? undefined : findCover(opf, opfPath, manifest, byId, getText, registerAsset);

  // SVG images become PNG here; any that cannot be converted are removed from the text and the cover.
  const dropped = await store.finalize();
  const kept = dropAssets(dropTitlePage(dropContentsPages(finalizeChapters(stripGutenberg(chapters, title))), title, author), coverName, dropped);

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
    ...(unreadable.n ? { warnings: [unreadableMessage(unreadable.n)] } : {}),
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
