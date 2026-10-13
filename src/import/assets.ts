// Images collected while importing: unique names, types found by sniffing the bytes, data: URIs.
//
// Only raster images are stored (PNG, JPEG, GIF, WebP, AVIF, BMP), each with the type its bytes show, not the
// type the book claimed. An SVG would be inert inside <img>, but "open image in new tab" (right-click, or a
// long-press on iPad) navigates to the blob URL itself, and there the SVG's own <script> and onload handlers
// run with this app's origin and can read its localStorage and IndexedDB. So SVG never reaches the store as
// SVG: it is drawn to a PNG once at import (an <img> never runs script), and dropped if that is not possible.
import type { Chapter } from '../types';
import { looksLikeSvg, sniffRaster } from './imageType';

/** One image over this size is skipped. */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_SVG_BYTES = 2 * 1024 * 1024;
const MAX_SVG_COUNT = 300;
const MAX_SVG_SIDE = 2048;
const SVG_TIMEOUT_MS = 4000;

/** Turns SVG bytes into PNG bytes, or null when it cannot (no DOM, a tainted canvas, a broken file). */
export type SvgRasterizer = (svg: Uint8Array) => Promise<Uint8Array | null>;

/** Draws the SVG through an <img> (scripts never run there) onto a canvas and reads back a PNG. */
export const browserSvgRasterizer: SvgRasterizer = async (svg) => {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(new Blob([svg as Uint8Array<ArrayBuffer>], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), SVG_TIMEOUT_MS);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('svg did not load')); };
      img.src = url;
    });
    let w = img.naturalWidth || 300;
    let h = img.naturalHeight || 150;
    const scale = Math.min(1, MAX_SVG_SIDE / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
};

let defaultRasterizer: SvgRasterizer = browserSvgRasterizer;
/** For tests (there is no DOM in node): replace the rasterizer every new AssetStore uses; pass nothing to restore the browser one. */
export function setDefaultSvgRasterizer(fn?: SvgRasterizer): void {
  defaultRasterizer = fn ?? browserSvgRasterizer;
}

/** FNV-1a over the bytes, so equal images share one asset even when their sources differ. */
function digest(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return `${bytes.length}:${(h >>> 0).toString(16)}`;
}

const RASTER_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp']);

export class AssetStore {
  /** Finished images, ready to store. Every entry is a raster image whose bytes were checked. */
  readonly assets = new Map<string, Blob>();
  private byKey = new Map<string, string>();
  private used = new Set<string>();
  /** SVGs waiting to be turned into PNG by finalize(); their names are reserved but not in `assets` yet. */
  private pendingSvg = new Map<string, Uint8Array>();

  constructor(private readonly rasterize: SvgRasterizer = defaultRasterizer) {}

  private unique(base: string, ext: string): string {
    let safe = base.replace(/[^\w.\-一-鿿]+/g, '_') || 'image';
    const have = /\.([A-Za-z0-9]+)$/.exec(safe)?.[1]?.toLowerCase();
    // Keep a raster extension as the book spelled it (a label only; the type comes from the bytes). Anything else,
    // such as .svg on a PNG or no extension at all, gets the extension the bytes call for.
    if (have === undefined) safe += `.${ext}`;
    else if (!RASTER_EXT.has(have)) safe = safe.replace(/\.[^.]*$/, `.${ext}`);
    let name = safe;
    for (let n = 2; this.used.has(name); n++) name = safe.replace(/(\.[^.]*)?$/, `-${n}$1`);
    this.used.add(name);
    return name;
  }

  /**
   * Store bytes under a name derived from `base`, once per `key`. Returns the asset name, or undefined when the
   * bytes are not an image Dushu keeps. The declared type is not used: the bytes decide.
   */
  add(key: string, base: string, bytes: Uint8Array): string | undefined {
    const known = this.byKey.get(key);
    if (known) return known;
    if (bytes.length > MAX_IMAGE_BYTES) return undefined;
    const raster = sniffRaster(bytes);
    if (raster) {
      const name = this.unique(base, raster.ext);
      this.assets.set(name, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: raster.mime }));
      this.byKey.set(key, name);
      return name;
    }
    if (bytes.length <= MAX_SVG_BYTES && this.pendingSvg.size < MAX_SVG_COUNT && looksLikeSvg(bytes)) {
      const name = this.unique(base, 'png');
      this.pendingSvg.set(name, bytes);
      this.byKey.set(key, name);
      return name;
    }
    return undefined;
  }

  addDataUri(src: string): string | undefined {
    const m = /^data:(image\/[\w.+-]+)(;base64)?,([\s\S]*)$/i.exec(src);
    if (!m || src.length > MAX_IMAGE_BYTES * 1.4) return undefined;
    try {
      const bytes = m[2]
        ? Uint8Array.from(atob(m[3].replace(/\s+/g, '')), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(m[3]));
      return this.add(`data:${digest(bytes)}`, 'inline', bytes);
    } catch {
      return undefined;
    }
  }

  /**
   * Turn every pending SVG into a PNG. Returns the names that could not be converted: they are not in `assets`,
   * so the caller removes the image blocks (and cover) that point at them with dropAssets().
   */
  async finalize(): Promise<Set<string>> {
    const dropped = new Set<string>();
    const queue = [...this.pendingSvg];
    this.pendingSvg.clear();
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const [name, svg] = queue[next++];
        let png: Uint8Array | null = null;
        try { png = await this.rasterize(svg); } catch { png = null; }
        // Whatever the rasterizer returned must itself be a PNG: nothing else is stored.
        if (png && sniffRaster(png)?.mime === 'image/png') this.assets.set(name, new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
        else dropped.add(name);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return dropped;
  }
}

/** Remove the image blocks that point at assets that were dropped; returns the cover, or undefined if it was dropped. */
export function dropAssets(chapters: Chapter[], cover: string | undefined, dropped: Set<string>): { chapters: Chapter[]; cover: string | undefined } {
  if (!dropped.size) return { chapters, cover };
  return {
    chapters: chapters.map((c) => ({ ...c, blocks: c.blocks.filter((b) => !(b.t === 'img' && dropped.has(b.asset))) })),
    cover: cover !== undefined && dropped.has(cover) ? undefined : cover,
  };
}
