// Parsing helpers for EPUB package files and XHTML/HTML content. Works in browsers and jsdom.

const VOID = 'area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr';

function hasParseError(doc: Document): boolean {
  return doc.getElementsByTagName('parsererror').length > 0;
}

function parseHtml(src: string): Document {
  // The HTML parser treats <a id="x"/> and <div/> as open tags and swallows what follows.
  const fixed = src.replace(new RegExp(`<(?!(?:${VOID})\\b)([a-zA-Z][\\w:-]*)((?:\\s[^<>]*?)?)\\s*/>`, 'g'), '<$1$2></$1>');
  return new DOMParser().parseFromString(fixed, 'text/html');
}

/** Parse XHTML as XML (faithful), falling back to the forgiving HTML parser on any error. */
export function parseXhtml(text: string): Document {
  const src = text.replace(/^\ufeff/, '').replace(/^\s*<\?xml[^>]*\?>/, '');
  try {
    const doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
    if (!hasParseError(doc) && doc.documentElement) return doc;
  } catch {
    // jsdom throws on malformed XML; browsers return a parsererror document
  }
  return parseHtml(src);
}

/** Parse an OPF, NCX or container file; tolerant of bare ampersands and HTML-only entities. */
export function parseXmlLoose(text: string): Document {
  const src = text.replace(/^\uFEFF/, '').replace(/^\s*<\?xml[^>]*\?>/, '');
  const attempts = [src, src.replace(/&(?!#?\w+;)/g, '&amp;')];
  for (const attempt of attempts) {
    try {
      const doc = new DOMParser().parseFromString(attempt, 'application/xml');
      if (!hasParseError(doc) && doc.documentElement) return doc;
    } catch {
      // try the next repair
    }
  }
  return parseHtml(src);
}

export function localName(el: Element): string {
  const n = (el.localName || el.tagName).toLowerCase();
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
}

/** All descendant elements with this local name, ignoring namespace prefixes. */
export function byLocal(root: Document | Element, name: string): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (localName(all[i]) === name) out.push(all[i]);
  return out;
}

export function childrenByLocal(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => localName(c) === name);
}

/** Attribute by local name, ignoring any prefix (epub:type, xlink:href, opf:role). */
export function attr(el: Element, name: string): string {
  const direct = el.getAttribute(name);
  if (direct !== null) return direct;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    const n = a.name.toLowerCase();
    if (n === name || n.endsWith(`:${name}`)) return a.value;
  }
  return '';
}

/** Text of an element without ruby annotations, scripts and styles, whitespace collapsed. */
export function plainText(el: Node): string {
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3 || n.nodeType === 4) {
      parts.push((n as CharacterData).data);
      return;
    }
    if (n.nodeType !== 1) return;
    const name = localName(n as Element);
    if (name === 'rt' || name === 'rp' || name === 'rtc' || name === 'script' || name === 'style') return;
    if (name === 'br') parts.push(' ');
    n.childNodes.forEach(walk);
  };
  walk(el);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Directory part of a zip path ("OEBPS/Text/a.xhtml" to "OEBPS/Text"). */
export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Resolve `href` against a zip path: drop query/fragment, URL-decode, collapse ./ and ../. */
export function resolvePath(baseFile: string, href: string): string {
  const clean = safeDecode(href.split('#')[0].split('?')[0]);
  const parts = (clean.startsWith('/') ? clean.slice(1) : dirname(baseFile) ? `${dirname(baseFile)}/${clean}` : clean).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

export function fragmentOf(href: string): string {
  const i = href.indexOf('#');
  return i < 0 ? '' : safeDecode(href.slice(i + 1));
}
