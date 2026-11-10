// The reader's corrections of a book (ARCHITECTURE.md §4.12): a word cut where it should not be, two words that are one, a
// reading, a name the detector missed. They act after the cut, so segment.ts never changes for them: a word fix joins the book's
// names and terms (withFixes; the cut then finds it), and applyFixes cuts, joins and reads the tokens of a paragraph as the fixes
// say. A fix holds everywhere in the book, or only at one place (an anchor, found again by its context when the book is imported
// again). Fixes are stored under the book's key (store.fixes), synced like bookmarks (core/sync.ts) and exported per book.
import type { Dictionary, Fix, FixAnchor, Lexicon, LexiconEntry, Token } from '../types';
import { buildLexicon } from './lexicon';
import { olderKeys } from './syncKeys';
import { ANCHOR_SIDE, cleanFix, fixId, isObj } from './fixRecord';

export { ANCHOR_SIDE, FIX_MAX_WORD, cleanFix, fixId, fixWire } from './fixRecord';

const cps = (s: string): string[] => [...s];
const lone = /^[\ud800-\udfff]$/;

/** The anchor of `length` UTF-16 units at `offset` in a stored block's text (the book's spelling). */
export function anchorAt(text: string, chapter: number, block: number, offset: number, length: number): FixAnchor {
  const before = cps(text.slice(Math.max(0, offset - ANCHOR_SIDE * 2), offset)).filter((c) => !lone.test(c)).slice(-ANCHOR_SIDE).join('');
  const after = cps(text.slice(offset + length, offset + length + ANCHOR_SIDE * 2)).filter((c) => !lone.test(c)).slice(0, ANCHOR_SIDE).join('');
  return { chapter, block, offset, before, after };
}

/** A new fix with its id: `book` is the book's key ('*' for every book), `bookId` its id here. */
export function makeFix(o: Omit<Fix, 'id' | 't' | 'on'> & { on?: boolean; t?: number }): Fix {
  const fix: Fix = { ...o, id: fixId(o.book, o.kind, o.word, o.at), on: o.on ?? true, t: o.t ?? Date.now() };
  if (fix.kind === 'word' && !fix.role) fix.role = 'user';
  for (const k of Object.keys(fix) as (keyof Fix)[]) if (fix[k] === undefined) delete fix[k];
  return fix;
}

/** The fixes of a book here: its own (by its id, its key, or a key an older importer gave it) and those made for every book. */
export function fixesOfBook(all: readonly Fix[], book: { id: string; key: string }): Fix[] {
  const keys = new Set([book.key, ...olderKeys(book.key)]);
  return all.filter((f) => f.book === '*' || f.bookId === book.id || keys.has(f.book));
}

const ROLE_GLOSS: Record<LexiconEntry['kind'], string> = { name: 'name (person)', place: 'place or group name', term: 'name or term in this book', user: '' };

/** A word fix as a row of the book's names and terms. */
export function fixEntry(f: Fix): LexiconEntry {
  const role = f.role ?? 'user';
  const e: LexiconEntry = { word: f.word, pinyin: f.pinyin ?? '', gloss: f.gloss || ROLE_GLOSS[role], kind: role, enabled: true, origin: 'user' };
  if (f.n) e.count = f.n;
  return e;
}

/** A word of the book's fixes (also a "here only" one, which the names and terms leave out), for the word card. */
export function fixedWord(lex: Lexicon | undefined, word: string): LexiconEntry | undefined {
  const f = lex?.fixes?.find((x) => x.kind === 'word' && x.word === word);
  return f && fixEntry(f);
}

/** Of the fixes in use, those that act on the cut tokens (applyFixes). Word fixes for every book stay names and terms only. */
const afterCut = (f: Fix) => f.on && f.book !== '*' && (f.kind === 'cut' || f.kind === 'reading' || f.kind === 'word');

/**
 * The book's names and terms with its fixes: a word fix made for every book counts least, the book's own names and terms next,
 * then its own names, places and other names ("not a word" takes the word out). Two words the reader joined as an ordinary word
 * of the book stay out of the cut's candidates: applyFixes joins them where the page cuts them into whole tokens, so a joined 有的
 * never takes 有的是 or 所有 apart elsewhere (a name, which the cut can glue to its neighbors, needs the cut to see it). The
 * fixes that act after the cut ride along (`fixes`). Any other field the lexicon carries (the old spellings, core/bookStyle.ts) is
 * kept.
 */
export function withFixes(lex: Lexicon | undefined, fixes: readonly Fix[]): Lexicon {
  const { has: _h, get: _g, entries: _e, maxLen: _m, fixes: _f, ...extra } = (lex ?? buildLexicon([])) as Lexicon & Record<string, unknown>;
  void _h; void _g; void _e; void _m; void _f;
  const on = fixes.filter((f) => f.on && f.kind !== 'spelling');
  const m = new Map<string, LexiconEntry>();
  for (const f of on) if (f.book === '*' && f.kind === 'word' && !f.at) m.set(f.word, fixEntry(f));
  for (const e of lex?.entries() ?? []) m.set(e.word, e);
  for (const f of on) {
    if (f.book === '*' || f.at) continue;
    if (f.kind === 'word' && f.role && f.role !== 'user') m.set(f.word, fixEntry(f));
    else if (f.kind === 'unword') m.delete(f.word);
  }
  const post = on.filter(afterCut);
  const out: Lexicon = { ...extra, ...buildLexicon([...m.values()]) };
  if (post.length) out.fixes = post;
  return out;
}

/** What the fixes change, as a string: equal for the same fixes in use (the reader redraws only when it differs). */
export function fixesSig(lex: Lexicon | undefined): string {
  return (lex?.fixes ?? []).map((f) => `${f.id}:${f.t}`).join(',');
}

// ------------------------------------------------------------------------------------------------- places ---

/** A "here only" fix placed in a paragraph: `start` is the UTF-16 offset of its word there. */
export interface HereFix { fix: Fix; start: number }

const endsWith = (s: string, tail: string) => !tail || s.endsWith(tail);

/**
 * Where each "here only" fix of chapter `chapter` is in the chapter's stored blocks (their texts as the book spells them; undefined
 * for a picture or a rule), by block. A fix is where its anchor says when its word and one side of its context are still there;
 * else (the book was imported again) at the place its word and whole context are, nearest the old block; else at the one place
 * its word and one side are. One that is nowhere is left out.
 */
export function placeHere(fixes: readonly Fix[] | undefined, chapter: number, blocks: readonly (string | undefined)[]): Map<number, HereFix[]> {
  const out = new Map<number, HereFix[]>();
  const add = (block: number, fix: Fix, start: number) => {
    const list = out.get(block) ?? [];
    list.push({ fix, start });
    out.set(block, list);
  };
  for (const fix of fixes ?? []) {
    const a = fix.at;
    if (!a || a.chapter !== chapter) continue;
    const t = blocks[a.block];
    if (t && t.startsWith(fix.word, a.offset)) {
      const head = t.slice(0, a.offset);
      const tail = t.slice(a.offset + fix.word.length);
      if (endsWith(head, a.before) || tail.startsWith(a.after)) { add(a.block, fix, a.offset); continue; }
    }
    const found = findOnce(blocks, a.before + fix.word + a.after, a.block) ?? (a.after ? unique(blocks, fix.word + a.after, false) : null)
      ?? (a.before ? unique(blocks, a.before + fix.word, true) : null);
    if (found) add(found.block, fix, found.offset + (found.lead ? a.before.length : 0));
  }
  return out;
}

/** The occurrence of `needle` nearest block `near` (the whole context: the word is right there). */
function findOnce(blocks: readonly (string | undefined)[], needle: string, near: number): { block: number; offset: number; lead: boolean } | null {
  let best: { block: number; offset: number; lead: boolean } | null = null;
  blocks.forEach((t, i) => {
    if (!t) return;
    const at = t.indexOf(needle);
    if (at < 0) return;
    if (!best || Math.abs(i - near) < Math.abs(best.block - near)) best = { block: i, offset: at, lead: true };
  });
  return best;
}

/** The one occurrence of `needle` in the chapter (null when there is none or more than one). `lead`: the needle starts with the
 * anchor's before-text, so the word comes after it. */
function unique(blocks: readonly (string | undefined)[], needle: string, lead: boolean): { block: number; offset: number; lead: boolean } | null {
  let hit: { block: number; offset: number; lead: boolean } | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const t = blocks[i];
    if (!t) continue;
    const at = t.indexOf(needle);
    if (at < 0) continue;
    if (hit || t.indexOf(needle, at + 1) >= 0) return null;
    hit = { block: i, offset: at, lead };
  }
  return hit;
}

/** The "here only" fixes of one rendered piece: those of its stored block from `from` (UTF-16) for `length` units, offsets made local. */
export function hereIn(placed: Map<number, HereFix[]> | undefined, block: number, from: number, length: number): HereFix[] | undefined {
  const list = placed?.get(block);
  if (!list) return undefined;
  const mine = list.filter((x) => x.start >= from && x.start + x.fix.word.length <= from + length).map((x) => ({ fix: x.fix, start: x.start - from }));
  return mine.length ? mine : undefined;
}

// ---------------------------------------------------------------------------------------------- the tokens ---

/** Numbered syllables of a fix that fit `n` code points, else null. */
function syllables(pinyin: string | undefined, n: number): string[] | null {
  const s = (pinyin ?? '').split(/\s+/).filter(Boolean);
  return s.length === n ? s : null;
}

/** The pieces of `word` cut at `cuts` (code points from its start). */
export function cutWord(word: string, cuts: readonly number[]): string[] {
  const chars = cps(word);
  const out: string[] = [];
  let from = 0;
  for (const c of [...cuts].sort((a, b) => a - b)) {
    if (c <= from || c >= chars.length) continue;
    out.push(chars.slice(from, c).join(''));
    from = c;
  }
  out.push(chars.slice(from).join(''));
  return out;
}

interface Ctx {
  dict: Dictionary;
  book: string;
  /** Tokens a fix made: they and their neighbors are read again once the cuts and joins are done (readAgain). */
  made: Set<Token>;
  /** Of those, the joins whose reading the reader gave: kept as given, like a name's. */
  given: Set<Token>;
}

/** A Han token for `shown` at `start` (read later, in readAgain). */
function hanToken(c: Ctx, shown: string, start: number): Token {
  const t: Token = { text: shown, start, end: start + shown.length, kind: 'han', pinyin: [], inDict: c.dict.hasWord(shown) };
  c.made.add(t);
  return t;
}

/** Cut token `i` at code points `cuts`. */
function cutToken(c: Ctx, toks: Token[], i: number, cuts: readonly number[]): void {
  const t = toks[i];
  const pieces = cutWord(t.text, cuts);
  if (pieces.length < 2) return;
  const out: Token[] = [];
  let at = t.start;
  for (const p of pieces) {
    out.push(hanToken(c, p, at));
    at += p.length;
  }
  toks.splice(i, 1, ...out);
}

/**
 * Cut the token holding UTF-16 offset `at` so a token starts there (no-op when one does). The piece left outside stays a word of its
 * own: joining it to its other neighbor when the dictionary has the pair (天 back to 今 in 今|天子|君) was as often wrong as right
 * on the audited corpus (能为|此术, 张生|于是|日), so the reader fixes that place if it needs it.
 */
function cutAt(c: Ctx, toks: Token[], at: number): void {
  const i = toks.findIndex((t) => t.start < at && t.end > at);
  if (i < 0 || toks[i].kind !== 'han') return;
  const t = toks[i];
  const n = cps(t.text.slice(0, at - t.start)).length;
  cutToken(c, toks, i, [n]);
}

/** Join the tokens from `start` to `end` (token edges, Han only) into one, read `pinyin` when it fits. */
function join(c: Ctx, toks: Token[], start: number, end: number, pinyin: string | undefined): boolean {
  const i = toks.findIndex((t) => t.start === start);
  let j = i;
  while (j >= 0 && j < toks.length && toks[j].end < end) j++;
  if (i < 0 || j >= toks.length || toks[j].end !== end || j === i) return false;
  const run = toks.slice(i, j + 1);
  if (run.some((t) => t.kind !== 'han')) return false;
  const t = hanToken(c, run.map((x) => x.text).join(''), start);
  const given = syllables(pinyin, cps(t.text).length);
  if (given) { t.pinyin = given; c.given.add(t); }
  toks.splice(i, j - i + 1, t);
  return true;
}

/**
 * The tokens a fix made, and the tokens beside them, read again as segment.ts reads every token: in the context of the new cut
 * (prev, next, the one after, the paragraph's tokens, the book's own characters, the old spellings), so a 地 after a joined 分外 reads
 * de, not the dì it had as part of 外地. A join whose reading the reader gave, and a name or term of the book, keep theirs.
 */
function readAgain(c: Ctx, toks: Token[], lexicon: Lexicon | undefined): void {
  const texts = toks.map((t) => t.text);
  const again = new Set<number>();
  toks.forEach((t, i) => { if (c.made.has(t)) for (const k of [i - 1, i, i + 1]) again.add(k); });
  for (const i of again) {
    const t = toks[i];
    if (!t || t.kind !== 'han' || c.given.has(t)) continue;
    const entry = cps(t.text).length >= 2 ? lexicon?.get(t.text) : undefined;
    const own = syllables(entry?.pinyin, cps(t.text).length);
    const orig = c.book.slice(t.start, t.end);
    const pinyin = own ?? c.dict.pinyinFor(t.text, {
      prev: toks[i - 1]?.text, next: toks[i + 1]?.text ?? '', after: toks[i + 2]?.text, line: texts, at: i,
      ...(orig !== t.text ? { orig } : {}),
      ...(lexicon?.spellings ? { spellings: lexicon.spellings } : {}),
    });
    toks[i] = c.made.has(t) ? Object.assign(t, { pinyin }) : { ...t, pinyin };
  }
}

/** Give the token at `i` the reading `pinyin` when it has one syllable per character. */
function read(toks: Token[], i: number, pinyin: string | undefined): void {
  const t = toks[i];
  const py = syllables(pinyin, cps(t.text).length);
  if (py) toks[i] = { ...t, pinyin: py };
}

/**
 * The tokens of a paragraph with the book's fixes applied. `book` is the paragraph as the book spells it, at the tokens' offsets (the
 * shown text when the book is shown as written); fixes name words that way, whichever script the page is in. `here` are the
 * "here only" fixes placed in this paragraph (placeHere, hereIn). Everywhere first, then here (a fix at one place beats the
 * book's rule): joins and cuts, the new tokens and their neighbors read again (readAgain, with the `lexicon` the cut had: its names'
 * readings and old spellings), then the readings the reader gave. Tokens untouched are returned as they are; with nothing to do,
 * the same array.
 */
export function applyFixes(tokens: Token[], book: string, dict: Dictionary, fixes: readonly Fix[] | undefined, here?: readonly HereFix[], lexicon?: Lexicon): Token[] {
  if (!fixes?.length && !here?.length) return tokens;
  const all = fixes ?? [];
  const c: Ctx = { dict, book, made: new Set(), given: new Set() };
  const toks = tokens.slice();
  const bookText = (t: Token) => book.slice(t.start, t.end);
  let changed = false;

  // Joins everywhere: wherever the word's characters are cut into whole tokens.
  for (const f of all) {
    if (f.kind !== 'word' || f.at || cps(f.word).length < 2) continue;
    for (let at = book.indexOf(f.word); at >= 0; at = book.indexOf(f.word, at + f.word.length)) {
      if (join(c, toks, at, at + f.word.length, f.pinyin)) changed = true;
    }
  }
  // Cuts everywhere: every token that is the word.
  const cuts = new Map(all.filter((f) => f.kind === 'cut' && !f.at && f.cuts?.length).map((f) => [f.word, f]));
  if (cuts.size) {
    for (let i = toks.length - 1; i >= 0; i--) {
      const f = toks[i].kind === 'han' ? cuts.get(bookText(toks[i])) : undefined;
      if (f) { cutToken(c, toks, i, f.cuts!); changed = true; }
    }
  }
  // Here: joins (the edges cut first when the page now cuts them otherwise), then cuts.
  for (const { fix: f, start } of here ?? []) {
    if (f.kind !== 'word' || book.slice(start, start + f.word.length) !== f.word) continue;
    cutAt(c, toks, start);
    cutAt(c, toks, start + f.word.length);
    join(c, toks, start, start + f.word.length, f.pinyin);
    changed = true;
  }
  for (const { fix: f, start } of here ?? []) {
    if (f.kind !== 'cut' || !f.cuts?.length) continue;
    const i = toks.findIndex((t) => t.start === start && t.kind === 'han' && bookText(t) === f.word);
    if (i >= 0) { cutToken(c, toks, i, f.cuts); changed = true; }
  }
  if (c.made.size) readAgain(c, toks, lexicon);
  // Readings: everywhere, then here.
  const reads = new Map(all.filter((f) => f.kind === 'reading' && !f.at).map((f) => [f.word, f]));
  if (reads.size) {
    for (let i = 0; i < toks.length; i++) {
      const f = toks[i].kind === 'han' ? reads.get(bookText(toks[i])) : undefined;
      if (f) { read(toks, i, f.pinyin); changed = true; }
    }
  }
  for (const { fix: f, start } of here ?? []) {
    if (f.kind !== 'reading') continue;
    const i = toks.findIndex((t) => t.start === start && t.kind === 'han' && bookText(t) === f.word);
    if (i >= 0) { read(toks, i, f.pinyin); changed = true; }
  }
  return changed ? toks : tokens;
}

// ------------------------------------------------------------------------------------------------- counts ---

/** Places `word` is in the texts (not overlapping). */
export function countIn(texts: readonly string[], word: string): number {
  if (!word) return 0;
  let n = 0;
  for (const t of texts) for (let at = t.indexOf(word); at >= 0; at = t.indexOf(word, at + word.length)) n++;
  return n;
}

// ---------------------------------------------------------------------------------------- checks, files ---


/** The file Export corrections writes: the book's fixes (and the reader's words for every book), nothing of the book's text but
 * the words fixed and their few characters of context. */
export function exportFixes(fixes: readonly Fix[], book: { title: string; key: string }): string {
  return JSON.stringify({
    app: 'dushu', corrections: 1, exportedAt: new Date().toISOString(), book: { title: book.title, key: book.key },
    fixes: fixes.map((f) => {
      const { id: _i, book: _k, bookId: _b, ...rest } = f;
      void _i; void _k; void _b;
      return { ...rest, ...(f.book === '*' ? { all: true } : {}) };
    }),
  }, null, 1);
}

/**
 * The fixes of a corrections file, made the fixes of `book` here (their ids follow: the same fix imported twice is one).
 * Throws with a message the reader can act on when the file is not one.
 */
export function importFixes(json: string, book: { id: string; key: string }): Fix[] {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error('That file is not a corrections file (it is not valid JSON).'); }
  if (!isObj(data) || data.app !== 'dushu' || data.corrections === undefined || !Array.isArray(data.fixes)) throw new Error('That file is not a Globereader corrections file.');
  if (typeof data.corrections === 'number' && data.corrections > 1) throw new Error('That file was made by a newer version of Globereader. Update the app and try again.');
  const out: Fix[] = [];
  for (const raw of data.fixes.slice(0, 5000)) {
    if (!isObj(raw)) continue;
    const all = raw.all === true && raw.kind === 'word' && !raw.at;
    const key = all ? '*' : book.key;
    const at = isObj(raw.at) ? raw.at as unknown as FixAnchor : undefined;
    const word = typeof raw.word === 'string' ? raw.word : '';
    const fix = cleanFix({ ...raw, book: key, bookId: all ? '*' : book.id, id: fixId(key, raw.kind as Fix['kind'], word, at) });
    if (fix) out.push(fix);
  }
  return out;
}
