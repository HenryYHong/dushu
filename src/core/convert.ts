// Script conversion tables (OpenCC): longest match over phrases first, then single characters.

export class ConvTable {
  private map = new Map<string, string>();
  /** First code point -> longest key length (in UTF-16 units) starting with it. */
  private maxLen = new Map<string, number>();

  add(from: string, to: string): void {
    if (!from || this.map.has(from)) return;
    this.map.set(from, to);
    const first = firstCodePoint(from);
    if ((this.maxLen.get(first) ?? 0) < from.length) this.maxLen.set(first, from.length);
  }

  get size(): number { return this.map.size; }

  get(from: string): string | undefined { return this.map.get(from); }

  convert(text: string): string {
    let out = '';
    let i = 0;
    let copyFrom = 0; // start of the pending run of unchanged text
    const n = text.length;
    while (i < n) {
      const c = text.charCodeAt(i);
      const step = c >= 0xd800 && c <= 0xdbff && i + 1 < n ? 2 : 1;
      const max = this.maxLen.get(step === 2 ? text.slice(i, i + 2) : text[i]);
      if (max === undefined) { i += step; continue; }
      let hit = '';
      let hitLen = 0;
      for (let len = Math.min(max, n - i); len >= step; len--) {
        // Never cut a surrogate pair in half.
        const cc = text.charCodeAt(i + len - 1);
        if (cc >= 0xd800 && cc <= 0xdbff) continue;
        const to = this.map.get(text.slice(i, i + len));
        if (to !== undefined) { hit = to; hitLen = len; break; }
      }
      if (!hitLen) { i += step; continue; }
      out += text.slice(copyFrom, i) + hit;
      i += hitLen;
      copyFrom = i;
    }
    return copyFrom === 0 ? text : out + text.slice(copyFrom);
  }
}

function firstCodePoint(s: string): string {
  const c = s.charCodeAt(0);
  return c >= 0xd800 && c <= 0xdbff && s.length > 1 ? s.slice(0, 2) : s[0];
}
