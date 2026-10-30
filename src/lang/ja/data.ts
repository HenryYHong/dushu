// The Japanese data files (scripts/lang/ja/build.mjs writes them to public/data/ja/): loading, and the JMdict and KANJIDIC
// readers.
//
// jmdict.tsv.gz, one JMdict entry per line (lines starting "# " are comments):
//   kanji forms \t kana forms \t JLPT level \t sense \t sense …
//   A form is its text, then "#" and flags when it has any, then (kana only) "@" and the indices of the kanji forms it
//   belongs to when it does not belong to all of them ("@-": to none). Flags: P common (JMdict's priority marks); kanji
//   I irregular, O out-dated, R rare, S search-only, A ateji, G irregular okurigana; kana I irregular, O out-dated, R rare,
//   S search-only, J jukujikun (gikun). The JLPT level is 1 (N5) … 5 (N1), empty when the word is on no list.
//   A sense is tags \x1f glosses, then optionally \x1f notes and \x1f restrictions. Tags are JMdict's codes (part of speech,
//   misc, field, dialect; tags.ts says them in English), glosses and notes are joined by "|", restrictions are
//   "k0,2;r1" (the sense applies only to those kanji and kana forms).
// kanji.tsv.gz: kanji \t strokes \t grade \t old JLPT level \t frequency rank \t on \t kun \t nanori \t meanings ("|").

export interface Form {
  text: string;
  common: boolean;
  /** The flag letters above, P excluded. */
  flags: string;
  /** Kana only: the kanji forms (indices) this reading belongs to; undefined = all of them. */
  only?: number[];
}

export interface RawSense {
  tags: string[];
  glosses: string[];
  notes: string[];
  /** The kanji and kana forms the sense is limited to (indices); undefined = all. */
  kanji?: number[];
  kana?: number[];
}

export interface Entry {
  /** Line number among the entries: stable for one data build. */
  id: number;
  kanji: Form[];
  kana: Form[];
  level?: number;
  senses: RawSense[];
  common: boolean;
  /** Usually written in kana alone: JMdict marks the first sense "uk" (or the entry has no kanji). */
  uk: boolean;
  /** Every part-of-speech tag of every sense. */
  pos: Set<string>;
}

const SEARCH_ONLY = 'S';

let yieldChannel: MessageChannel | null = null;
/**
 * Give the event loop a turn so the page can paint and handle input between parse chunks (the same MessageChannel round trip
 * as core/dict.ts: a plain task with no 4 ms timer clamp).
 */
export function yieldToEventLoop(): Promise<void> {
  if (typeof window !== 'undefined' && typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      yieldChannel ??= new MessageChannel();
      const ch = yieldChannel;
      ch.port1.onmessage = () => { ch.port1.onmessage = null; resolve(); };
      ch.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Undo gzip when the bytes are gzipped (a server may have undone it already). */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { gunzipSync } = await import('fflate');
  return gunzipSync(bytes);
}

/** A data file's bytes over fetch (so the service worker can cache it), refusing the HTML a dev server sends for a 404. */
export async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x3c && /^\s*<(!doctype|html)/i.test(new TextDecoder().decode(bytes.subarray(0, 100)))) throw new Error(`${url}: not a data file`);
  return bytes;
}

function parseForm(raw: string, kana: boolean): Form {
  let text = raw;
  let flags = '';
  let only: number[] | undefined;
  const at = kana ? text.indexOf('@') : -1;
  if (at >= 0) {
    const r = text.slice(at + 1);
    only = r === '-' ? [] : r.split(',').map(Number);
    text = text.slice(0, at);
  }
  const hash = text.indexOf('#');
  if (hash >= 0) {
    flags = text.slice(hash + 1);
    text = text.slice(0, hash);
  }
  const common = flags.includes('P');
  if (common) flags = flags.replace('P', '');
  return { text, common, flags, only };
}

function parseRestr(s: string, sense: RawSense): void {
  for (const part of s.split(';')) {
    if (!part) continue;
    const list = part.slice(1) ? part.slice(1).split(',').map(Number) : [];
    if (part[0] === 'k') sense.kanji = list;
    else if (part[0] === 'r') sense.kana = list;
  }
}

/** The text of a form without its flags. */
function formText(raw: string): string {
  let e = raw.length;
  const h = raw.indexOf('#');
  if (h >= 0) e = h;
  const a = raw.indexOf('@');
  if (a >= 0 && a < e) e = a;
  return e === raw.length ? raw : raw.slice(0, e);
}

export class Jmdict {
  private text = '';
  private starts = new Int32Array(0);
  private count = 0;
  /** Form → entry id, or −(k + 1) for the k-th list in `lists` when several entries share the form. */
  private index = new Map<string, number>();
  private lists: number[][] = [];
  private cache = new Map<number, Entry>();
  private levelIds: number[][] = [[], [], [], [], [], []];

  get size(): number { return this.count; }

  /** Reads the file, yielding to the event loop now and then; `progress(0..1)`. */
  async load(text: string, progress?: (f: number) => void): Promise<void> {
    this.text = text;
    const starts: number[] = [];
    let pos = 0;
    const n = text.length;
    let lines = 0;
    while (pos < n) {
      let nl = text.indexOf('\n', pos);
      if (nl < 0) nl = n;
      if (nl > pos && !(text.charCodeAt(pos) === 35 && text.charCodeAt(pos + 1) === 32)) {
        const id = starts.length;
        starts.push(pos);
        const t1 = text.indexOf('\t', pos);
        const t2 = text.indexOf('\t', t1 + 1);
        const t3 = text.indexOf('\t', t2 + 1);
        if (t1 > pos) for (const f of text.slice(pos, t1).split(';')) this.add(formText(f), id);
        if (t2 > t1 + 1) for (const f of text.slice(t1 + 1, t2).split(';')) this.add(formText(f), id);
        if (t3 > t2 + 1) {
          const lv = text.charCodeAt(t2 + 1) - 48;
          if (lv >= 1 && lv <= 5) this.levelIds[lv].push(id);
        }
      }
      pos = nl + 1;
      if (++lines % 20000 === 0) {
        progress?.(pos / n);
        await yieldToEventLoop();
      }
    }
    starts.push(n + 1);
    this.starts = Int32Array.from(starts);
    this.count = starts.length - 1;
    progress?.(1);
  }

  private add(form: string, id: number): void {
    if (!form) return;
    const cur = this.index.get(form);
    if (cur === undefined) { this.index.set(form, id); return; }
    if (cur >= 0) {
      if (cur === id) return;
      this.lists.push([cur, id]);
      this.index.set(form, -this.lists.length);
      return;
    }
    const list = this.lists[-cur - 1];
    if (list[list.length - 1] !== id) list.push(id);
  }

  /** Entry ids with this exact form (kanji or kana). */
  ids(form: string): number[] {
    const v = this.index.get(form);
    if (v === undefined) return [];
    return v >= 0 ? [v] : this.lists[-v - 1];
  }

  has(form: string): boolean {
    return this.index.has(form);
  }

  /** Forms longer than three letters, by their first two; built the first time a prefix is asked for. */
  private byPrefix: Map<string, string[]> | null = null;

  /** Forms that start with `prefix` (two letters or more) and are longer than it, at most `limit`. */
  formsStartingWith(prefix: string, limit = 400): string[] {
    if (prefix.length < 2) return [];
    if (!this.byPrefix) {
      const m = new Map<string, string[]>();
      for (const f of this.index.keys()) {
        if (f.length < 3) continue;
        const k = f.slice(0, 2);
        const list = m.get(k);
        if (list) list.push(f);
        else m.set(k, [f]);
      }
      this.byPrefix = m;
    }
    const out: string[] = [];
    for (const f of this.byPrefix.get(prefix.slice(0, 2)) ?? []) {
      if (f.length <= prefix.length || !f.startsWith(prefix)) continue;
      out.push(f);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Entry ids on the JLPT list of `level` (1 = N5). */
  levelIdsOf(level: number): readonly number[] {
    return this.levelIds[level] ?? [];
  }

  entry(id: number): Entry {
    let e = this.cache.get(id);
    if (e) return e;
    const line = this.text.slice(this.starts[id], this.starts[id + 1] - 1);
    const cols = line.split('\t');
    const kanji = cols[0] ? cols[0].split(';').map((f) => parseForm(f, false)) : [];
    const kana = cols[1] ? cols[1].split(';').map((f) => parseForm(f, true)) : [];
    const level = cols[2] ? Number(cols[2]) : undefined;
    const senses: RawSense[] = [];
    const pos = new Set<string>();
    for (let k = 3; k < cols.length; k++) {
      const parts = cols[k].split('\u001f');
      const s: RawSense = { tags: parts[0] ? parts[0].split(',') : [], glosses: parts[1] ? parts[1].split('|') : [], notes: parts[2] ? parts[2].split('|') : [] };
      if (parts[3]) parseRestr(parts[3], s);
      senses.push(s);
      for (const t of s.tags) pos.add(t);
    }
    const common = kanji.some((f) => f.common) || kana.some((f) => f.common);
    const uk = !kanji.length || !!senses[0]?.tags.includes('uk') || kanji.every((f) => f.flags.includes(SEARCH_ONLY));
    e = { id, kanji, kana, level: level && level >= 1 && level <= 5 ? level : undefined, senses, common, uk, pos };
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(id, e);
    return e;
  }
}

/** The form an entry is saved under: its first kanji form, or its first kana form when it is usually written in kana. */
export function headOf(e: Entry): string {
  const shown = (f: Form) => !f.flags.includes(SEARCH_ONLY);
  if (!e.uk) {
    // A spelling in words, not digits (二十歳 before ２０歳), common before uncommon.
    const words = e.kanji.filter((f) => shown(f) && !/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]/.test(f.text));
    const k = words.find((f) => f.common) ?? words[0] ?? e.kanji.find(shown);
    if (k) return k.text;
  }
  const kana = e.kana.filter(shown);
  return (kana.find((f) => f.common) ?? kana[0] ?? e.kana[0] ?? e.kanji[0]).text;
}

// ---------------------------------------------------------------- kanji ---

export interface KanjiRow {
  char: string;
  strokes?: number;
  grade?: number;
  jlpt?: number;
  freq?: number;
  on: string[];
  kun: string[];
  nanori: string[];
  meanings: string[];
}

export class Kanjidic {
  private rows = new Map<string, string>();

  load(text: string): void {
    for (const line of text.split('\n')) {
      if (!line || line.startsWith('# ')) continue;
      const tab = line.indexOf('\t');
      this.rows.set(line.slice(0, tab), line);
    }
  }

  get size(): number { return this.rows.size; }

  get(ch: string): KanjiRow | undefined {
    const line = this.rows.get(ch);
    if (!line) return undefined;
    const c = line.split('\t');
    const num = (s: string) => (s ? Number(s) : undefined);
    const list = (s: string) => (s ? s.split(' ') : []);
    return {
      char: c[0], strokes: num(c[1]), grade: num(c[2]), jlpt: num(c[3]), freq: num(c[4]),
      on: list(c[5]), kun: list(c[6]), nanori: list(c[7]), meanings: c[8] ? c[8].split('|') : [],
    };
  }
}
