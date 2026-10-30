// Persistence over IndexedDB (memory fallback). Contract: ARCHITECTURE.md §4.6.
import type {
  BackupReport, Bookmark, BookMeta, Chapter, Grade, ImportedBook, LookupRow, Progress, ReviewLog, SeenRow, Settings, SrsState, Store, StoreChange, SyncRow, VocabItem, LexiconEntry,
} from '../types';
import { hanBefore, moveByPercent, placeAt, textHan } from '../core/place';
import { bookKey, canonical, mergeLookups, olderKeys, progressWire } from '../core/syncKeys';
import { sanitizeSrs, schedule } from '../core/srs';
import { sniffRaster } from '../import/imageType';
import { countHan as countLetters } from '../import/han';
import { TABLES, createIdbBackend, createMemoryBackend, friendlyError, type Backend, type Table } from './db';
import { SETTINGS_KEY, defaultsFor, sanitizePatch, sanitizeSettings } from './settings';
import { langId, langKey } from '../lang/active';
import { LANGS, isLangId } from '../lang/registry';

export { QUOTA_MESSAGE } from './db';

/** The store as openStore returns it (kept as an alias for older imports). */
export type DushuStore = Store;
export type { BackupReport };

// ------------------------------------------------------------------ helpers ---

/**
 * Han code points: Unified (incl. Ext A–J), compatibility ideographs, and 〇. The store's own range, kept for Chinese as it
 * was: a book's character count goes into its sync key (core/syncKeys.ts), so a wider range would give old and new devices
 * different keys for the same book.
 */
function isHan(cp: number): boolean {
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x323af) || cp === 0x3007;
}

/** Chinese: Han characters (the range above); another language: its letters (import/han.ts). */
function countHan(s: string): number {
  if (langId() !== 'zh') return countLetters(s);
  let n = 0;
  for (const ch of s) if (isHan(ch.codePointAt(0)!)) n++;
  return n;
}

function chapterHan(c: Chapter): number {
  let n = countHan(c.title);
  for (const b of c.blocks) if ('text' in b) n += countHan(b.text);
  return n;
}

/** A Blob's bytes (FileReader where Blob.arrayBuffer is missing: older Safari, jsdom). */
export async function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('Could not read an image from the book'));
    r.readAsArrayBuffer(blob);
  });
}

/**
 * Assets are stored as bytes plus a type, not as Blobs: WebKit can hang forever on a Blob written to IndexedDB (seen in an
 * ephemeral Playwright context; Safari private windows are the same engine path). The stored type is the one the bytes show,
 * never the one the book declared; anything that is not a raster image (an SVG, which would run script if opened as a page)
 * is not saved.
 */
async function assetRowsOf(bookId: string, book: ImportedBook) {
  const rows: { op: 'put'; table: 'assets'; value: { bookId: string; name: string; data: ArrayBuffer; type: string } }[] = [];
  for (const [name, blob] of book.assets) {
    const data = await bytesOf(blob);
    const type = sniffRaster(new Uint8Array(data, 0, Math.min(data.byteLength, 64)));
    if (type) rows.push({ op: 'put', table: 'assets', value: { bookId, name, data, type: type.mime } });
  }
  return rows;
}

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function backupBookIdentities(db: Backend): Promise<{ id: string; digest: string }[]> {
  if (!globalThis.crypto?.subtle) return []; // Older/insecure environments retain v1 backup behavior.
  const books = await db.getAll<BookMeta>('books');
  const identities: { id: string; digest: string }[] = [];
  for (const book of books) {
    const chapters: Chapter[] = [];
    for (let index = 0; index < book.chapterCount; index++) {
      const row = await db.get<{ chapter: Chapter }>('chapters', [book.id, index]);
      if (!row) break;
      chapters.push(row.chapter);
    }
    if (chapters.length !== book.chapterCount) continue;
    const bytes = new TextEncoder().encode(JSON.stringify(chapters));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    identities.push({ id: book.id, digest: [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('') });
  }
  return identities;
}

/** A lexicon row as stored: the entry plus the scope it belongs to. */
type LexRow = LexiconEntry & { scope: string };
function rowToEntry(r: LexRow): LexiconEntry {
  const { scope: _scope, ...e } = r;
  void _scope;
  return e;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const fin = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Longest values a backup may put in a field. A longer key is refused; a longer note is cut. */
const LIMITS = { key: 100, pinyin: 200, gloss: 2000, sentence: 1000, title: 200, word: 64 };
const cut = (v: unknown, max: number) => str(v).slice(0, max);

function cleanLexRow(v: unknown): LexRow | null {
  if (!isObj(v)) return null;
  const word = str(v.word).trim();
  const scope = str(v.scope).trim();
  if (!word || !scope || word.length > 40) return null;
  const kind = v.kind === 'name' || v.kind === 'place' || v.kind === 'term' || v.kind === 'user' ? v.kind : 'user';
  const out: LexRow = {
    scope: scope.slice(0, LIMITS.key), word, pinyin: cut(v.pinyin, LIMITS.pinyin), gloss: cut(v.gloss, LIMITS.gloss), kind,
    enabled: v.enabled !== false, origin: v.origin === 'auto' ? 'auto' : 'user',
  };
  if (typeof v.count === 'number' && Number.isFinite(v.count)) out.count = v.count;
  return out;
}

export function cleanVocab(v: unknown): VocabItem | null {
  if (!isObj(v)) return null;
  const simp = str(v.simp) || str(v.id);
  const id = str(v.id) || simp;
  // A headword is a word, not a document: anything past the limit is not a real card.
  if (!id || id.length > LIMITS.key || simp.length > LIMITS.key) return null;
  const addedAt = fin(v.addedAt, Date.now());
  const trad = str(v.trad, simp || id);
  const item: VocabItem = {
    id, simp: simp || id, trad: trad.length > LIMITS.key ? simp || id : trad, pinyin: cut(v.pinyin, LIMITS.pinyin),
    gloss: cut(v.gloss, LIMITS.gloss), addedAt, srs: sanitizeSrs(v.srs, addedAt),
  };
  const context = cleanContext(v.context);
  if (context) item.context = context;
  return item;
}

export function cleanProgress(v: unknown): Progress | null {
  if (!isObj(v) || typeof v.bookId !== 'string' || !v.bookId || v.bookId.length > LIMITS.key) return null;
  const out: Progress = {
    bookId: v.bookId,
    chapter: Math.max(0, Math.round(fin(v.chapter, 0))),
    block: Math.max(0, Math.round(fin(v.block, 0))),
    percent: Math.min(1, Math.max(0, fin(v.percent, 0))),
    updatedAt: fin(v.updatedAt, 0),
  };
  if (typeof v.offset === 'number' && Number.isFinite(v.offset) && v.offset > 0) out.offset = Math.round(v.offset);
  return out;
}

function cleanContext(v: unknown): VocabItem['context'] | undefined {
  if (!isObj(v) || typeof v.sentence !== 'string') return undefined;
  const c: NonNullable<VocabItem['context']> = { sentence: v.sentence.slice(0, LIMITS.sentence) };
  if (typeof v.bookId === 'string' && v.bookId.length <= LIMITS.key) c.bookId = v.bookId;
  if (typeof v.bookTitle === 'string') c.bookTitle = v.bookTitle.slice(0, LIMITS.title);
  if (typeof v.chapter === 'number' && Number.isFinite(v.chapter)) c.chapter = v.chapter;
  return c;
}

/** A looked-up word's row from another device, or null when it is not one. */
export function cleanLookup(v: unknown): LookupRow | null {
  if (!isObj(v) || typeof v.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.day)) return null;
  const id = str(v.id);
  if (!id || id.length > LIMITS.word) return null;
  const last = fin(v.last, 0);
  const out: LookupRow = {
    day: v.day, id, word: str(v.word, id).slice(0, LIMITS.word) || id, pinyin: cut(v.pinyin, LIMITS.pinyin), gloss: cut(v.gloss, LIMITS.gloss),
    count: Math.max(1, Math.round(fin(v.count, 1))), first: fin(v.first, last), last,
  };
  const context = cleanContext(v.context);
  if (context) out.context = context;
  return out;
}

/** A bookmark from another device, or null when it is not one. */
export function cleanBookmark(v: unknown): Bookmark | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  const bookId = str(v.bookId);
  if (!id || id.length > LIMITS.key || !bookId || bookId.length > LIMITS.key) return null;
  const out: Bookmark = {
    id, bookId,
    chapter: Math.max(0, Math.round(fin(v.chapter, 0))),
    block: Math.max(0, Math.round(fin(v.block, 0))),
    offset: Math.max(0, Math.round(fin(v.offset, 0))),
    label: cut(v.label, LIMITS.title),
    createdAt: fin(v.createdAt, 0),
  };
  if (typeof v.bookKey === 'string' && v.bookKey && v.bookKey.length <= LIMITS.key) out.bookKey = v.bookKey;
  return out;
}

/** A known-words row: `auto` when reading marked it (settings.autoKnown). */
interface KnownRow { word: string; auto?: true }

/** When an item last changed: its last review, else when it was added. */
const stamp = (v: VocabItem) => Math.max(v.srs.last ?? 0, v.addedAt);

// -------------------------------------------------------------------- store ---

/** How long IndexedDB gets to answer when the app starts. Some WebKit versions never answer at all. */
export const IDB_OPEN_TIMEOUT_MS = 4000;

/** Messages between tabs (or between stores of one name in one page) when something was saved. */
interface ChangeMessage { db: string; from: string; what: StoreChange; removed?: string }
const CHANNEL = 'dushu';
/** Used when BroadcastChannel does not exist: stores in the same page still hear each other. */
const inPage = new Set<(m: ChangeMessage) => void>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`IndexedDB did not answer within ${Math.round(ms / 1000)} seconds`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export async function openStore(name = 'dushu', opts: { idbTimeoutMs?: number } = {}): Promise<Store> {
  let backend: Backend;
  try {
    backend = await withTimeout(createIdbBackend(name), opts.idbTimeoutMs ?? IDB_OPEN_TIMEOUT_MS);
    try { void navigator.storage?.persist?.(); } catch { /* best effort */ }
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'VersionError') {
      throw new Error('Your saved data was written by a newer version of Dushu. Update the app to open it.', { cause: e });
    }
    console.warn('Dushu: IndexedDB is unavailable, so books and words will be kept in memory only and lost on reload.', e);
    backend = createMemoryBackend();
  }
  const db = backend;
  const write = (ops: Parameters<Backend['commit']>[0]) => db.commit(ops).catch((e) => { throw friendlyError(e); });

  // ---- events
  const listeners = new Set<(what: StoreChange, info?: { remote: boolean }) => void>();
  const notify = (what: StoreChange, remote: boolean) => {
    for (const fn of [...listeners]) {
      try { fn(what, { remote }); } catch (e) { console.error('store listener failed', e); }
    }
  };

  // Other tabs: a save in one tab is announced to the rest, which reload what they keep in memory and tell their screens.
  // A store that only lives in memory has nobody to talk to.
  const tabId = newId();
  let channel: BroadcastChannel | null = null;
  const post = (m: ChangeMessage) => {
    if (db.kind !== 'idb') return;
    if (channel) { try { channel.postMessage(m); } catch { /* a closed channel: nothing to tell */ } }
    else for (const fn of [...inPage]) fn(m);
  };
  const onRemote = async (m: ChangeMessage) => {
    if (!m || typeof m !== 'object' || m.db !== name || m.from === tabId) return;
    if (!['vocab', 'known', 'books', 'lookups', 'bookmarks'].includes(m.what)) return;
    try {
      if (m.what === 'vocab') rebuildVocab(await db.getAll<VocabItem>('vocab'));
      else if (m.what === 'known') loadKnown(await db.getAll<KnownRow>('known')); else if (m.what === 'books' && typeof m.removed === 'string') dropUrls(m.removed);
    } catch (e) { console.error('Dushu: could not refresh after a change in another tab', e); return; }
    notify(m.what, true);
  };
  if (db.kind === 'idb') {
    if (typeof BroadcastChannel === 'function') {
      try {
        channel = new BroadcastChannel(CHANNEL);
        channel.onmessage = (ev: MessageEvent) => { void onRemote(ev.data as ChangeMessage); };
        (channel as unknown as { unref?: () => void }).unref?.(); // Node: do not keep a process alive
      } catch { channel = null; }
    }
    if (!channel) inPage.add((m) => { void onRemote(m); });
  }
  const emit = (what: StoreChange, removed?: string) => {
    notify(what, false);
    post(removed === undefined ? { db: name, from: tabId, what } : { db: name, from: tabId, what, removed });
  };

  // ---- in-memory membership for sync has()
  let normalize: (w: string) => string = (w) => w;
  let normalizerSet = false;
  const vocabKeys = new Set<string>(); // simp + trad of every item
  const vocabNorm = new Set<string>();
  const knownWords = new Set<string>();
  const knownNorm = new Set<string>();
  /** Known words that reading marked (settings.autoKnown), a subset of knownWords. */
  const autoWords = new Set<string>();
  const autoNorm = new Set<string>();
  const norm = (w: string) => { try { return normalize(w); } catch { return w; } };

  const addVocabKeys = (it: Pick<VocabItem, 'id' | 'simp' | 'trad'>) => {
    for (const k of [it.id, it.simp, it.trad]) {
      if (!k) continue;
      vocabKeys.add(k);
      if (normalizerSet) vocabNorm.add(norm(k));
    }
  };
  const rebuildVocab = (items: VocabItem[]) => {
    vocabKeys.clear(); vocabNorm.clear();
    for (const it of items) addVocabKeys(it);
  };
  const addKnown = (w: string, auto = false) => {
    knownWords.add(w);
    if (normalizerSet) knownNorm.add(norm(w));
    if (auto) { autoWords.add(w); if (normalizerSet) autoNorm.add(norm(w)); }
    else autoWords.delete(w); // the normalized set is rebuilt by the caller when a word stops being learned
  };
  const rebuildKnown = () => {
    knownNorm.clear();
    autoNorm.clear();
    if (normalizerSet) {
      for (const w of knownWords) knownNorm.add(norm(w));
      for (const w of autoWords) autoNorm.add(norm(w));
    }
  };
  const loadKnown = (rows: KnownRow[]) => {
    knownWords.clear();
    autoWords.clear();
    for (const k of rows) { knownWords.add(k.word); if (k.auto) autoWords.add(k.word); }
    rebuildKnown();
  };

  rebuildVocab(await db.getAll<VocabItem>('vocab'));
  loadKnown(await db.getAll<KnownRow>('known'));

  // Serializes read-modify-write operations (reviews, imports) so they cannot interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  // ---- reading places kept for books that are not here
  type Ops = Parameters<Backend['commit']>[0];
  /**
   * A deleted book's place is kept in its sync row (as core/sync.ts keeps a place the Mac sent before the book arrived), so
   * adding the same book again opens it where it was. Sync never deletes places, so the Mac keeps it too.
   */
  async function keepPlace(meta: BookMeta | undefined): Promise<Ops> {
    const place = meta && await db.get<Progress>('progress', meta.id);
    if (!meta || !place) return [];
    const key = `p:${bookKey(meta)}`;
    const row = await db.get<SyncRow>('sync', key);
    return [{ op: 'put', table: 'sync', value: { ...(row ?? { key, at: place.updatedAt, sig: '' }), held: progressWire(place) } }];
  }
  /**
   * Sync rows a sync round writes back, merged with the rows as they are stored now. The round built them from the rows it
   * read when it began, and a book deleted (keepPlace) or added again (keptPlace) meanwhile changes a row's held place. A
   * round only changes `held` from the one in `seen`, so a held place that is no longer that stands. Called inside
   * `exclusive`, as books.remove runs, so nothing can change a row between this read and the write that follows it.
   */
  async function mergeHeld(put: SyncRow[], seen: ReadonlyMap<string, SyncRow> | undefined): Promise<SyncRow[]> {
    if (!seen) return put;
    const out: SyncRow[] = [];
    for (const row of put) {
      const stored = row.key.startsWith('p:') ? await db.get<SyncRow>('sync', row.key) : undefined;
      if (!stored || canonical(stored.held) === canonical(seen.get(row.key)?.held)) { out.push(row); continue; }
      const { held: _h, ...rest } = row;
      void _h;
      out.push(stored.held === undefined ? rest : { ...rest, held: stored.held });
    }
    return out;
  }
  /**
   * The place kept for a book, once the book is here under its key (just added, or just marked as the Mac's): as it was, or
   * from an older importer's key moved by its percent. The newest wins, and only over an older place here.
   */
  async function keptPlace(meta: BookMeta, chapter: (index: number) => Chapter | undefined | Promise<Chapter | undefined>): Promise<Ops> {
    const key = bookKey(meta);
    const here = await db.get<Progress>('progress', meta.id);
    let best = here;
    const ops: Ops = [];
    for (const k of [key, ...olderKeys(key)]) {
      const row = await db.get<SyncRow>('sync', `p:${k}`);
      if (row?.held === undefined) continue;
      const { held, ...rest } = row;
      ops.push({ op: 'put', table: 'sync', value: rest });
      const kept = cleanProgress({ ...(held as object), bookId: meta.id });
      if (!kept) continue;
      const p = k === key ? kept : await moveByPercent(meta, progressWire(kept), chapter);
      if (!best || p.updatedAt > best.updatedAt) best = p;
    }
    if (best && best !== here) ops.push({ op: 'put', table: 'progress', value: best });
    return ops;
  }

  // ---- assets
  const urls = new Map<string, Promise<string | undefined>>();
  const urlKey = (bookId: string, name: string) => JSON.stringify([bookId, name]);
  const dropUrls = (bookId: string) => {
    for (const [k, p] of [...urls]) {
      if ((JSON.parse(k) as string[])[0] !== bookId) continue;
      urls.delete(k);
      void p.then((u) => { if (u) URL.revokeObjectURL(u); });
    }
  };

  const store: Store = {
    backend: db.kind,

    lexicon: {
      async get(scope) {
        return (await db.getAll<LexRow>('lexicon')).filter((r) => r.scope === scope).map(rowToEntry);
      },
      putDetected(scope, entries, version = 0) {
        return exclusive(async () => {
          const rows = (await db.getAll<LexRow>('lexicon')).filter((r) => r.scope === scope);
          const keep = (r: LexRow) => r.origin !== 'auto' || !r.enabled;
          const have = new Set(rows.filter(keep).map((r) => r.word));
          const ops: Parameters<Backend['commit']>[0] = [];
          for (const r of rows) if (!keep(r)) ops.push({ op: 'del', table: 'lexicon', key: [scope, r.word] });
          for (const e of entries) {
            if (!e.word || have.has(e.word)) continue;
            ops.push({ op: 'put', table: 'lexicon', value: { ...e, origin: 'auto', scope } });
          }
          ops.push({ op: 'put', table: 'lexiconScopes', value: { scope, detectedAt: Date.now(), version } });
          for (let i = 0; i < ops.length; i += 2000) await write(ops.slice(i, i + 2000));
        });
      },
      async upsert(scope, entry) {
        if (!entry.word) throw new Error('A name or term needs its characters.');
        await write([{ op: 'put', table: 'lexicon', value: { ...entry, scope } }]);
      },
      async remove(scope, word) {
        await write([{ op: 'del', table: 'lexicon', key: [scope, word] }]);
      },
      async detected(scope, minVersion = 0) {
        const rec = await db.get<{ version?: number }>('lexiconScopes', scope);
        return !!rec && (rec.version ?? 0) >= minVersion;
      },
    },

    books: {
      async list() {
        const all = await db.getAll<BookMeta>('books');
        return all.sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
      },
      get: (id) => db.get<BookMeta>('books', id),
      async chapter(id, index) {
        const rec = await db.get<{ chapter: Chapter }>('chapters', [id, index]);
        return rec?.chapter;
      },
      async add(book: ImportedBook) {
        const id = newId();
        const offsets: number[] = [];
        let total = 0;
        for (const c of book.chapters) { offsets.push(total); total += chapterHan(c); }
        const meta: BookMeta = {
          id, title: book.title, author: book.author, format: book.format, script: book.script,
          addedAt: Date.now(), chapterCount: book.chapters.length, charCount: total, chapterOffsets: offsets,
          chapterTitles: book.chapters.map((c) => c.title),
        };
        if (book.cover !== undefined) meta.cover = book.cover;
        if (book.sourceName !== undefined) meta.sourceName = book.sourceName;
        if (book.note !== undefined) meta.note = book.note;
        if (book.importVersion !== undefined) meta.importVersion = book.importVersion;
        await write([
          { op: 'put', table: 'books', value: meta },
          ...book.chapters.map((chapter, index) => ({ op: 'put' as const, table: 'chapters' as const, value: { bookId: id, index, chapter } })),
          ...await assetRowsOf(id, book),
          ...await keptPlace(meta, (i) => book.chapters[i]),
        ]);
        emit('books');
        return meta;
      },
      async replace(id, book) {
        const cur = await db.get<BookMeta>('books', id);
        if (!cur) throw new Error('That book is no longer in your library.');
        // The reading place moves to the same character in the new chapters.
        const place = await db.get<Progress>('progress', id);
        let moved: Progress | undefined;
        if (place && place.chapter >= 0 && place.chapter < cur.chapterCount) {
          let pos = 0;
          for (let i = 0; i < place.chapter; i++) {
            const c = (await db.get<{ chapter: Chapter }>('chapters', [id, i]))?.chapter;
            if (c) pos += textHan(c);
          }
          const here = (await db.get<{ chapter: Chapter }>('chapters', [id, place.chapter]))?.chapter;
          if (here) pos += hanBefore(here, place.block, place.offset ?? 0);
          const at = placeAt(book.chapters, pos);
          moved = { ...place, chapter: at.chapter, block: at.block };
          if (place.offset !== undefined) moved.offset = at.offset;
        }
        const offsets: number[] = [];
        let total = 0;
        for (const c of book.chapters) { offsets.push(total); total += chapterHan(c); }
        // Its name, notes and history stay: only what the importer makes is new.
        const meta: BookMeta = {
          ...cur, format: book.format, script: book.script, chapterCount: book.chapters.length, charCount: total,
          chapterOffsets: offsets, chapterTitles: book.chapters.map((c) => c.title),
        };
        if (book.cover !== undefined) meta.cover = book.cover; else delete meta.cover;
        if (book.importVersion !== undefined) meta.importVersion = book.importVersion;
        await write([
          { op: 'delBook', table: 'chapters', bookId: id },
          { op: 'delBook', table: 'assets', bookId: id },
          { op: 'put', table: 'books', value: meta },
          ...book.chapters.map((chapter, index) => ({ op: 'put' as const, table: 'chapters' as const, value: { bookId: id, index, chapter } })),
          ...await assetRowsOf(id, book),
          ...(moved ? [{ op: 'put' as const, table: 'progress' as const, value: moved }] : []),
        ]);
        dropUrls(id);
        emit('books', id);
        return meta;
      },
      async update(id, patch) {
        const cur = await db.get<BookMeta>('books', id);
        if (!cur) throw new Error('That book is no longer in your library.');
        const next: BookMeta = { ...cur, ...patch, id };
        // Marked as the Mac's book (or otherwise renamed for sync): a place kept under its new key lands now.
        const kept = bookKey(next) === bookKey(cur) ? [] : await keptPlace(next, async (i) => (await db.get<{ chapter: Chapter }>('chapters', [id, i]))?.chapter);
        await write([{ op: 'put', table: 'books', value: next }, ...kept]);
        emit('books');
      },
      remove(id) {
        // In turn with the rows a sync writes back (mergeHeld), so the place kept here is never overwritten by a sync that
        // was running.
        return exclusive(async () => {
          const kept = await keepPlace(await db.get<BookMeta>('books', id));
          await write([
            ...kept,
            { op: 'del', table: 'books', key: id },
            { op: 'delBook', table: 'chapters', bookId: id },
            { op: 'delBook', table: 'assets', bookId: id },
            { op: 'delBook', table: 'lexicon', bookId: id },
            { op: 'del', table: 'lexiconScopes', key: id },
            { op: 'del', table: 'progress', key: id },
          ]);
          dropUrls(id);
          emit('books', id);
        });
      },
      async setCover(id, image, from) {
        const cur = await db.get<BookMeta>('books', id);
        if (!cur) throw new Error('That book is no longer in your library.');
        const data = await bytesOf(image);
        const type = sniffRaster(new Uint8Array(data, 0, Math.min(data.byteLength, 64)));
        if (!type) throw new Error('That cover is not a picture Dushu can show.');
        // A new name for each picture, so a cached address for the old one is never shown for the new.
        const name = `cover-${from.replace(/[^\w.-]+/g, '-').slice(-40)}`;
        await write([
          { op: 'put', table: 'assets', value: { bookId: id, name, data, type: type.mime } },
          { op: 'put', table: 'books', value: { ...cur, cover: name, coverFrom: from } },
        ]);
        emit('books');
      },
      async asset(bookId, asset) {
        const rec = await db.get<{ blob?: Blob; data?: ArrayBuffer; type?: string }>('assets', [bookId, asset]);
        const data = rec ? rec.data ?? (rec.blob ? await bytesOf(rec.blob) : undefined) : undefined;
        if (!data) return undefined;
        const type = sniffRaster(new Uint8Array(data, 0, Math.min(data.byteLength, 64)));
        return type ? new Blob([data], { type: type.mime }) : undefined;
      },
      assetUrl(bookId, asset) {
        const key = urlKey(bookId, asset);
        let p = urls.get(key);
        if (!p) {
          p = db.get<{ blob?: Blob; data?: ArrayBuffer; type?: string }>('assets', [bookId, asset]).then(async (rec) => {
            if (!rec) return undefined;
            // Rows written by an older version hold a Blob; newer ones hold bytes and a type. Either way the type
            // given to the object URL comes from the bytes: a stored SVG (from before SVGs were converted) or any other
            // non-raster file gets no URL, because opened as its own page it would run with this app's origin.
            const data = rec.data ?? (rec.blob ? await bytesOf(rec.blob) : undefined);
            if (!data) return undefined;
            const type = sniffRaster(new Uint8Array(data, 0, Math.min(data.byteLength, 64)));
            return type ? URL.createObjectURL(new Blob([data], { type: type.mime })) : undefined;
          });
          urls.set(key, p);
          // Do not cache misses or failures: the asset may be added later.
          p.then((u) => { if (!u && urls.get(key) === p) urls.delete(key); }, () => { if (urls.get(key) === p) urls.delete(key); });
        }
        return p;
      },
    },

    progress: {
      get: (bookId) => db.get<Progress>('progress', bookId),
      set: (p) => write([{ op: 'put', table: 'progress', value: p }]),
    },

    vocab: {
      list: () => db.getAll<VocabItem>('vocab'),
      get: (id) => db.get<VocabItem>('vocab', id),
      async put(item) {
        if (!item.id) throw new Error('A saved word needs a headword.');
        await write([{ op: 'put', table: 'vocab', value: item }]);
        addVocabKeys(item);
        emit('vocab');
      },
      async remove(id) {
        await write([{ op: 'del', table: 'vocab', key: id }]);
        rebuildVocab(await db.getAll<VocabItem>('vocab'));
        emit('vocab');
      },
      async due(now) {
        const all = await db.getAll<VocabItem>('vocab');
        return all.filter((v) => v.srs.due <= now).sort((a, b) => a.srs.due - b.srs.due);
      },
      has(word) {
        return vocabKeys.has(word) || (normalizerSet && vocabNorm.has(norm(word)));
      },
      review(id, grade: Grade, now) {
        return exclusive(async () => {
          const cur = await db.get<VocabItem>('vocab', id);
          if (!cur) throw new Error('That word is no longer in your list.');
          const next: VocabItem = { ...cur, srs: schedule(cur.srs, grade, now) };
          const log: Omit<ReviewLog, 'id'> = { itemId: id, grade, at: now };
          await write([{ op: 'put', table: 'vocab', value: next }, { op: 'put', table: 'reviews', value: log }]);
          emit('vocab');
          return next;
        });
      },
      logs: () => db.getAll<ReviewLog>('reviews'),
    },

    lookups: {
      log(row, at) {
        return exclusive(async () => {
          const cur = await db.get<LookupRow>('lookups', [row.day, row.id]);
          const next: LookupRow = cur
            ? { ...cur, word: row.word, pinyin: row.pinyin || cur.pinyin, gloss: row.gloss || cur.gloss, count: cur.count + 1, last: at, context: row.context ?? cur.context }
            : { ...row, count: 1, first: at, last: at };
          await write([{ op: 'put', table: 'lookups', value: next }]);
          emit('lookups');
        });
      },
      list: () => db.getAll<LookupRow>('lookups'),
      async remove(day, id) {
        await write([{ op: 'del', table: 'lookups', key: [day, id] }]);
        emit('lookups');
      },
    },

    bookmarks: {
      async list(bookId) {
        const all = await db.getAll<Bookmark>('bookmarks');
        return (bookId ? all.filter((b) => b.bookId === bookId) : all).sort((a, b) => a.chapter - b.chapter || a.block - b.block || a.offset - b.offset);
      },
      async put(b) {
        await write([{ op: 'put', table: 'bookmarks', value: b }]);
        emit('bookmarks');
      },
      async remove(id) {
        await write([{ op: 'del', table: 'bookmarks', key: id }]);
        emit('bookmarks');
      },
    },

    known: {
      has: (word) => knownWords.has(word) || (normalizerSet && knownNorm.has(norm(word))),
      async add(words, opts = {}) {
        const auto = !!opts.auto;
        // Reading never overrides the person: a word they marked (or one already learned) is left as it is.
        const clean = [...new Set(words.map((w) => w.trim()).filter(Boolean))]
          .filter((w) => (auto ? !knownWords.has(w) : !knownWords.has(w) || autoWords.has(w)));
        if (!clean.length) return;
        await write(clean.map((word) => ({ op: 'put' as const, table: 'known' as const, value: auto ? { word, auto: true } : { word } })));
        for (const w of clean) addKnown(w, auto);
        if (!auto) rebuildKnown();
        emit('known');
      },
      async remove(words) {
        const present = [...new Set(words)].filter((w) => knownWords.has(w));
        if (!present.length) return;
        await write(present.map((word) => ({ op: 'del' as const, table: 'known' as const, key: word })));
        for (const w of present) { knownWords.delete(w); autoWords.delete(w); }
        rebuildKnown();
        emit('known');
      },
      all: () => [...knownWords],
      count: () => knownWords.size,
      isAuto: (word) => autoWords.has(word) || (normalizerSet && !knownWords.has(word) && autoNorm.has(norm(word))),
      autoCount: () => autoWords.size,
    },

    seen: {
      async get(words) {
        const rows = await Promise.all([...new Set(words)].map((w) => db.get<SeenRow>('seen', w)));
        return rows.filter((r): r is SeenRow => !!r);
      },
      async put(rows) {
        for (let i = 0; i < rows.length; i += 2000) await write(rows.slice(i, i + 2000).map((value) => ({ op: 'put' as const, table: 'seen' as const, value })));
      },
      async remove(words) {
        const unique = [...new Set(words)];
        if (unique.length) await write(unique.map((key) => ({ op: 'del' as const, table: 'seen' as const, key })));
      },
      clear: () => write([{ op: 'clear', table: 'seen' }]),
    },

    sync: {
      rows: () => db.getAll<SyncRow>('sync'),
      write(put, del = [], seen) {
        return exclusive(async () => {
          const ops: Parameters<Backend['commit']>[0] = [
            ...del.map((key) => ({ op: 'del' as const, table: 'sync' as const, key })),
            ...(await mergeHeld(put, seen)).map((value) => ({ op: 'put' as const, table: 'sync' as const, value })),
          ];
          for (let i = 0; i < ops.length; i += 2000) await write(ops.slice(i, i + 2000));
        });
      },
      apply(change) {
        return exclusive(async () => {
          const ops: Parameters<Backend['commit']>[0] = [];
          for (const item of change.vocabPut ?? []) {
            const clean = cleanVocab(item);
            if (clean) ops.push({ op: 'put', table: 'vocab', value: clean });
          }
          for (const id of change.vocabDel ?? []) ops.push({ op: 'del', table: 'vocab', key: id });
          for (const k of change.knownPut ?? []) {
            const word = typeof k.word === 'string' ? k.word.trim() : '';
            if (word && word.length <= LIMITS.word) ops.push({ op: 'put', table: 'known', value: k.auto ? { word, auto: true } : { word } });
          }
          for (const word of change.knownDel ?? []) ops.push({ op: 'del', table: 'known', key: word });
          for (const p of change.progressPut ?? []) {
            const clean = cleanProgress(p);
            if (clean) ops.push({ op: 'put', table: 'progress', value: clean });
          }
          for (const r of change.lookupsPut ?? []) {
            const clean = cleanLookup(r);
            if (!clean) continue;
            // Merged with the row here, read in this turn: a lookup made here while the sync ran is kept.
            const here = await db.get<LookupRow>('lookups', [clean.day, clean.id]);
            ops.push({ op: 'put', table: 'lookups', value: here ? mergeLookups(here, clean) : clean });
          }
          for (const { day, id } of change.lookupsDel ?? []) ops.push({ op: 'del', table: 'lookups', key: [day, id] });
          for (const b of change.bookmarksPut ?? []) {
            const clean = cleanBookmark(b);
            if (clean) ops.push({ op: 'put', table: 'bookmarks', value: clean });
          }
          for (const id of change.bookmarksDel ?? []) ops.push({ op: 'del', table: 'bookmarks', key: id });
          for (const row of await mergeHeld(change.rows ?? [], change.seen)) ops.push({ op: 'put', table: 'sync', value: row });
          // One transaction: the records and the rows that say they are in step can never disagree.
          await write(ops);
          const vocab = !!(change.vocabPut?.length || change.vocabDel?.length);
          const known = !!(change.knownPut?.length || change.knownDel?.length);
          if (vocab) rebuildVocab(await db.getAll<VocabItem>('vocab'));
          if (known) loadKnown(await db.getAll<KnownRow>('known'));
          // Heard here as remote (another device made the change) and told to the other tabs like any save.
          const lookups = !!(change.lookupsPut?.length || change.lookupsDel?.length);
          const bookmarks = !!(change.bookmarksPut?.length || change.bookmarksDel?.length);
          for (const what of [vocab && 'vocab', known && 'known', lookups && 'lookups', bookmarks && 'bookmarks'] as const) {
            if (!what) continue;
            notify(what, true);
            post({ db: name, from: tabId, what });
          }
        });
      },
    },

    async exportBackup() {
      const [vocab, progress, reviews, lexRows] = await Promise.all([
        db.getAll<VocabItem>('vocab'), db.getAll<Progress>('progress'), db.getAll<ReviewLog>('reviews'), db.getAll<LexRow>('lexicon'),
      ]);
      // Detected names are cheap to find again; the user's own words and the ones they rejected are not.
      const lexicon = lexRows.filter((r) => r.origin === 'user' || !r.enabled);
      // Stable, content-based identities allow an independently imported iPad copy to receive
      // progress/term edits. Hashes only, never book text or images, are included in backups.
      const bookIdentities = await backupBookIdentities(db);
      let settings: Partial<Settings> | undefined;
      try {
        const raw = globalThis.localStorage?.getItem(langKey(SETTINGS_KEY));
        if (raw) settings = sanitizeSettings(JSON.parse(raw), defaultsFor(langId()));
      } catch { /* no settings to include */ }
      return JSON.stringify({
        app: 'dushu', version: 1, exportedAt: new Date().toISOString(), ...(langId() !== 'zh' ? { lang: langId() } : {}),
        settings, vocab, known: [...knownWords], knownAuto: [...autoWords], progress, reviews, lexicon, bookIdentities,
      });
    },

    importBackup(json) {
      return exclusive(async () => {
        let data: unknown;
        try { data = JSON.parse(json); } catch { throw new Error('That file is not a Dushu backup (it is not valid JSON).'); }
        if (!isObj(data) || data.app !== 'dushu') throw new Error('That file is not a Dushu backup.');
        // A backup made while reading another language holds that language's words: they would be noise here.
        const from = isLangId(data.lang) ? data.lang : 'zh';
        if (from !== langId()) throw new Error(`That backup is from Dushu in ${LANGS[from].name}. Switch to ${LANGS[from].name} to restore it.`);
        if (typeof data.version === 'number' && data.version > 1) {
          throw new Error('That backup was made by a newer version of Dushu. Update the app and try again.');
        }
        const report: BackupReport = {
          vocab: { added: 0, updated: 0, skipped: 0 }, known: { added: 0 },
          progress: { added: 0, updated: 0, skipped: 0 }, reviews: { added: 0 },
        };
        const ops: Parameters<Backend['commit']>[0] = [];
        const bookMap = new Map<string, string>();
        const incomingBooks = Array.isArray(data.bookIdentities) ? data.bookIdentities.filter((v: unknown): v is { id: string; digest: string } =>
          isObj(v) && typeof v.id === 'string' && typeof v.digest === 'string' && /^[a-f0-9]{64}$/.test(v.digest)) : [];
        if (incomingBooks.length) {
          const localBooks = await backupBookIdentities(db);
          for (const old of incomingBooks) {
            const exact = localBooks.find(b => b.id === old.id && b.digest === old.digest);
            const matches = localBooks.filter(b => b.digest === old.digest);
            if (exact) bookMap.set(old.id, exact.id);
            else if (matches.length === 1) bookMap.set(old.id, matches[0].id);
          }
        }
        const hasIdentity = new Set(incomingBooks.map(b => b.id));

        const existing = new Map((await db.getAll<VocabItem>('vocab')).map((v) => [v.id, v]));
        for (const raw of Array.isArray(data.vocab) ? data.vocab : []) {
          const inc = cleanVocab(raw);
          if (!inc) { report.vocab.skipped++; continue; }
          if (inc.context?.bookId && bookMap.has(inc.context.bookId)) inc.context.bookId = bookMap.get(inc.context.bookId)!;
          const cur = existing.get(inc.id);
          if (!cur) report.vocab.added++;
          else if (stamp(inc) > stamp(cur)) report.vocab.updated++;
          else { report.vocab.skipped++; continue; }
          existing.set(inc.id, inc);
          ops.push({ op: 'put', table: 'vocab', value: inc });
        }

        const learned = new Set((Array.isArray(data.knownAuto) ? data.knownAuto : []).filter((w): w is string => typeof w === 'string').map((w) => w.trim()));
        for (const w of Array.isArray(data.known) ? data.known : []) {
          if (typeof w !== 'string' || !w.trim() || w.trim().length > LIMITS.word || knownWords.has(w.trim())) continue;
          const word = w.trim();
          report.known.added++;
          ops.push({ op: 'put', table: 'known', value: learned.has(word) ? { word, auto: true } : { word } });
        }

        const curProgress = new Map((await db.getAll<Progress>('progress')).map((p) => [p.bookId, p]));
        for (const raw of Array.isArray(data.progress) ? data.progress : []) {
          const inc = cleanProgress(raw);
          if (!inc) { report.progress.skipped++; continue; }
          if (hasIdentity.has(inc.bookId) && !bookMap.has(inc.bookId)) { report.progress.skipped++; continue; }
          inc.bookId = bookMap.get(inc.bookId) ?? inc.bookId;
          const cur = curProgress.get(inc.bookId);
          if (!cur) report.progress.added++;
          else if (inc.updatedAt > cur.updatedAt) report.progress.updated++;
          else { report.progress.skipped++; continue; }
          curProgress.set(inc.bookId, inc);
          ops.push({ op: 'put', table: 'progress', value: inc });
        }

        const seen = new Set((await db.getAll<ReviewLog>('reviews')).map((r) => `${r.itemId}|${r.at}|${r.grade}`));
        for (const raw of Array.isArray(data.reviews) ? data.reviews : []) {
          if (!isObj(raw) || typeof raw.itemId !== 'string' || raw.itemId.length > LIMITS.key || typeof raw.at !== 'number' || !Number.isFinite(raw.at) || raw.at < 0 || raw.at > 8.64e15) continue;
          const grade = raw.grade;
          if (grade !== 0 && grade !== 1 && grade !== 2 && grade !== 3) continue;
          const k = `${raw.itemId}|${raw.at}|${grade}`;
          if (seen.has(k)) continue;
          seen.add(k);
          report.reviews.added++;
          ops.push({ op: 'put', table: 'reviews', value: { itemId: raw.itemId, grade, at: raw.at } });
        }

        const haveLex = new Set((await db.getAll<LexRow>('lexicon')).map((r) => JSON.stringify([r.scope, r.word])));
        for (const raw of Array.isArray(data.lexicon) ? data.lexicon : []) {
          const inc = cleanLexRow(raw);
          if (!inc) continue;
          if (hasIdentity.has(inc.scope) && !bookMap.has(inc.scope)) continue;
          inc.scope = bookMap.get(inc.scope) ?? inc.scope;
          const k = JSON.stringify([inc.scope, inc.word]);
          if (haveLex.has(k)) continue;
          haveLex.add(k);
          ops.push({ op: 'put', table: 'lexicon', value: inc });
        }

        if (isObj(data.settings)) {
          const rest = sanitizePatch(data.settings);
          // Claude and MyMemory send the selected text to a third party; that is a choice made on this device, never
          // one a file can make for you. The other translators stay on the device (or are the automatic choice).
          if (rest.translator === 'claude' || rest.translator === 'mymemory') delete rest.translator;
          // Local only is a promise about this device; a backup file can never turn it off.
          delete rest.localOnly;
          report.settings = rest;
        }

        // Chunk so one huge backup cannot exceed a single transaction's limits.
        for (let i = 0; i < ops.length; i += 2000) await write(ops.slice(i, i + 2000));

        for (const o of ops) {
          if (o.op === 'put' && o.table === 'known') addKnown((o.value as KnownRow).word, !!(o.value as KnownRow).auto);
        }
        rebuildVocab([...existing.values()]);
        if (report.vocab.added + report.vocab.updated + report.reviews.added) emit('vocab');
        if (report.known.added) emit('known');
        return report;
      });
    },

    async wipe() {
      await exclusive(async () => {
        await write((Object.keys(TABLES) as Table[]).map((table) => ({ op: 'clear' as const, table })));
        for (const [, p] of urls) void p.then((u) => { if (u) URL.revokeObjectURL(u); });
        urls.clear();
        knownWords.clear();
        autoWords.clear();
        rebuildKnown();
        rebuildVocab([]);
      });
      emit('books');
      emit('vocab');
      emit('known');
    },

    onChange(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },

    setNormalizer(fn) {
      normalize = fn;
      normalizerSet = true;
      rebuildKnown();
      vocabNorm.clear();
      for (const k of vocabKeys) vocabNorm.add(norm(k));
    },
  };
  return store;
}
