// Persistence over IndexedDB (memory fallback). Contract: ARCHITECTURE.md §4.6.
import type {
  BackupReport, BookMeta, Chapter, Grade, ImportedBook, Progress, ReviewLog, Settings, SrsState, Store, VocabItem, LexiconEntry,
} from '../types';
import { newSrs, schedule } from '../core/srs';
import { TABLES, createIdbBackend, createMemoryBackend, friendlyError, type Backend, type Table } from './db';
import { SETTINGS_KEY, sanitizePatch, sanitizeSettings } from './settings';

export { QUOTA_MESSAGE } from './db';

/** The store as openStore returns it (kept as an alias for older imports). */
export type DushuStore = Store;
export type { BackupReport };

// ------------------------------------------------------------------ helpers ---

/** Han code points: Unified (incl. Ext A–J), compatibility ideographs, and 〇. */
function isHan(cp: number): boolean {
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x323af) || cp === 0x3007;
}

function countHan(s: string): number {
  let n = 0;
  for (const ch of s) if (isHan(ch.codePointAt(0)!)) n++;
  return n;
}

function chapterHan(c: Chapter): number {
  let n = countHan(c.title);
  for (const b of c.blocks) if ('text' in b) n += countHan(b.text);
  return n;
}

async function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('Could not read an image from the book'));
    r.readAsArrayBuffer(blob);
  });
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

function cleanSrs(v: unknown, fallbackNow: number): SrsState {
  const base = newSrs(fallbackNow);
  if (!isObj(v)) return base;
  const out: SrsState = {
    due: fin(v.due, base.due),
    interval: Math.max(0, fin(v.interval, 0)),
    ease: Math.max(1.3, fin(v.ease, 2.5)),
    reps: Math.max(0, Math.round(fin(v.reps, 0))),
    lapses: Math.max(0, Math.round(fin(v.lapses, 0))),
  };
  if (typeof v.last === 'number' && Number.isFinite(v.last)) out.last = v.last;
  return out;
}

function cleanLexRow(v: unknown): LexRow | null {
  if (!isObj(v)) return null;
  const word = str(v.word).trim();
  const scope = str(v.scope).trim();
  if (!word || !scope || word.length > 40) return null;
  const kind = v.kind === 'name' || v.kind === 'place' || v.kind === 'term' || v.kind === 'user' ? v.kind : 'user';
  const out: LexRow = {
    scope, word, pinyin: str(v.pinyin), gloss: str(v.gloss), kind,
    enabled: v.enabled !== false, origin: v.origin === 'auto' ? 'auto' : 'user',
  };
  if (typeof v.count === 'number' && Number.isFinite(v.count)) out.count = v.count;
  return out;
}

function cleanVocab(v: unknown): VocabItem | null {
  if (!isObj(v)) return null;
  const simp = str(v.simp) || str(v.id);
  const id = str(v.id) || simp;
  if (!id) return null;
  const addedAt = fin(v.addedAt, Date.now());
  const item: VocabItem = {
    id, simp: simp || id, trad: str(v.trad, simp || id), pinyin: str(v.pinyin), gloss: str(v.gloss),
    addedAt, srs: cleanSrs(v.srs, addedAt),
  };
  if (isObj(v.context) && typeof v.context.sentence === 'string') {
    item.context = { sentence: v.context.sentence };
    if (typeof v.context.bookId === 'string') item.context.bookId = v.context.bookId;
    if (typeof v.context.bookTitle === 'string') item.context.bookTitle = v.context.bookTitle;
    if (typeof v.context.chapter === 'number') item.context.chapter = v.context.chapter;
  }
  return item;
}

function cleanProgress(v: unknown): Progress | null {
  if (!isObj(v) || typeof v.bookId !== 'string' || !v.bookId) return null;
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

/** When an item last changed: its last review, else when it was added. */
const stamp = (v: VocabItem) => Math.max(v.srs.last ?? 0, v.addedAt);

// -------------------------------------------------------------------- store ---

export async function openStore(name = 'dushu'): Promise<Store> {
  let backend: Backend;
  try {
    backend = await createIdbBackend(name);
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
  const listeners = new Set<(what: 'vocab' | 'known' | 'books') => void>();
  const emit = (what: 'vocab' | 'known' | 'books') => {
    for (const fn of [...listeners]) {
      try { fn(what); } catch (e) { console.error('store listener failed', e); }
    }
  };

  // ---- in-memory membership for sync has()
  let normalize: (w: string) => string = (w) => w;
  let normalizerSet = false;
  const vocabKeys = new Set<string>(); // simp + trad of every item
  const vocabNorm = new Set<string>();
  const knownWords = new Set<string>();
  const knownNorm = new Set<string>();
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
  const addKnown = (w: string) => { knownWords.add(w); if (normalizerSet) knownNorm.add(norm(w)); };
  const rebuildKnown = () => {
    knownNorm.clear();
    if (normalizerSet) for (const w of knownWords) knownNorm.add(norm(w));
  };

  rebuildVocab(await db.getAll<VocabItem>('vocab'));
  for (const k of await db.getAll<{ word: string }>('known')) knownWords.add(k.word);

  // Serializes read-modify-write operations (reviews, imports) so they cannot interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  // ---- assets
  const urls = new Map<string, Promise<string | undefined>>();
  const urlKey = (bookId: string, name: string) => JSON.stringify([bookId, name]);

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
        // Assets are stored as bytes plus a type, not as Blobs: WebKit can hang forever on a Blob written to IndexedDB
        // (seen in an ephemeral Playwright context; Safari private windows are the same engine path).
        const assetRows = await Promise.all([...book.assets].map(async ([name, blob]) => ({
          op: 'put' as const, table: 'assets' as const, value: { bookId: id, name, data: await bytesOf(blob), type: blob.type },
        })));
        await write([
          { op: 'put', table: 'books', value: meta },
          ...book.chapters.map((chapter, index) => ({ op: 'put' as const, table: 'chapters' as const, value: { bookId: id, index, chapter } })),
          ...assetRows,
        ]);
        emit('books');
        return meta;
      },
      async update(id, patch) {
        const cur = await db.get<BookMeta>('books', id);
        if (!cur) throw new Error('That book is no longer in your library.');
        await write([{ op: 'put', table: 'books', value: { ...cur, ...patch, id } }]);
        emit('books');
      },
      async remove(id) {
        await write([
          { op: 'del', table: 'books', key: id },
          { op: 'delBook', table: 'chapters', bookId: id },
          { op: 'delBook', table: 'assets', bookId: id },
          { op: 'delBook', table: 'lexicon', bookId: id },
          { op: 'del', table: 'lexiconScopes', key: id },
          { op: 'del', table: 'progress', key: id },
        ]);
        for (const [k, p] of [...urls]) {
          if ((JSON.parse(k) as string[])[0] !== id) continue;
          urls.delete(k);
          void p.then((u) => { if (u) URL.revokeObjectURL(u); });
        }
        emit('books');
      },
      assetUrl(bookId, asset) {
        const key = urlKey(bookId, asset);
        let p = urls.get(key);
        if (!p) {
          p = db.get<{ blob?: Blob; data?: ArrayBuffer; type?: string }>('assets', [bookId, asset]).then((rec) => {
            if (!rec) return undefined;
            // Rows written by an older version hold a Blob; newer ones hold bytes and a type.
            const blob = rec.blob ?? (rec.data ? new Blob([rec.data], { type: rec.type ?? '' }) : null);
            return blob ? URL.createObjectURL(blob) : undefined;
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

    known: {
      has: (word) => knownWords.has(word) || (normalizerSet && knownNorm.has(norm(word))),
      async add(words) {
        const clean = [...new Set(words.map((w) => w.trim()).filter(Boolean))];
        if (!clean.length) return;
        await write(clean.map((word) => ({ op: 'put' as const, table: 'known' as const, value: { word } })));
        for (const w of clean) addKnown(w);
        emit('known');
      },
      async remove(words) {
        const present = [...new Set(words)].filter((w) => knownWords.has(w));
        if (!present.length) return;
        await write(present.map((word) => ({ op: 'del' as const, table: 'known' as const, key: word })));
        for (const w of present) knownWords.delete(w);
        rebuildKnown();
        emit('known');
      },
      all: () => [...knownWords],
      count: () => knownWords.size,
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
        const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
        if (raw) { const { claudeApiKey: _key, ...rest } = sanitizeSettings(JSON.parse(raw)); void _key; settings = rest; }
      } catch { /* no settings to include */ }
      return JSON.stringify({
        app: 'dushu', version: 1, exportedAt: new Date().toISOString(),
        settings, vocab, known: [...knownWords], progress, reviews, lexicon, bookIdentities,
      });
    },

    importBackup(json) {
      return exclusive(async () => {
        let data: unknown;
        try { data = JSON.parse(json); } catch { throw new Error('That file is not a Dushu backup (it is not valid JSON).'); }
        if (!isObj(data) || data.app !== 'dushu') throw new Error('That file is not a Dushu backup.');
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

        for (const w of Array.isArray(data.known) ? data.known : []) {
          if (typeof w !== 'string' || !w.trim() || knownWords.has(w.trim())) continue;
          const word = w.trim();
          report.known.added++;
          ops.push({ op: 'put', table: 'known', value: { word } });
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
          if (!isObj(raw) || typeof raw.itemId !== 'string' || typeof raw.at !== 'number') continue;
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
          const { claudeApiKey: _k, ...rest } = sanitizePatch(data.settings);
          void _k;
          report.settings = rest;
        }

        // Chunk so one huge backup cannot exceed a single transaction's limits.
        for (let i = 0; i < ops.length; i += 2000) await write(ops.slice(i, i + 2000));

        for (const o of ops) {
          if (o.op === 'put' && o.table === 'known') addKnown((o.value as { word: string }).word);
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
