// Images collected while importing: unique names, mime types, data: URIs.

export class AssetStore {
  readonly assets = new Map<string, Blob>();
  private byKey = new Map<string, string>();
  private used = new Set<string>();

  /** Store bytes under a name derived from `base`, once per `key`. Returns the asset name. */
  add(key: string, base: string, bytes: Uint8Array, mime: string): string {
    const known = this.byKey.get(key);
    if (known) return known;
    const safe = base.replace(/[^\w.\-一-鿿]+/g, '_') || 'image';
    let name = safe;
    for (let n = 2; this.used.has(name); n++) name = safe.replace(/(\.[^.]*)?$/, `-${n}$1`);
    this.used.add(name);
    this.assets.set(name, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
    this.byKey.set(key, name);
    return name;
  }

  addDataUri(src: string): string | undefined {
    const m = /^data:(image\/[\w.+-]+)(;base64)?,([\s\S]*)$/.exec(src);
    if (!m) return undefined;
    try {
      const bin = m[2] ? atob(m[3].replace(/\s+/g, '')) : decodeURIComponent(m[3]);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const ext = m[1].split('/')[1].replace('+xml', '');
      return this.add(`data:${src.length}:${src.slice(-32)}`, `inline.${ext}`, bytes, m[1]);
    } catch {
      return undefined;
    }
  }
}
