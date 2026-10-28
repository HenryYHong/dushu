// Known words learned from reading (settings.autoKnown). A word that goes by on enough pages, over more than one day,
// without being looked up is marked known with `auto`, so the Unknown pinyin mode stops showing its pinyin. Looking it up
// takes it back off. The reader (ui/reader/learning.ts) tells this module what is on screen about once a second; nothing
// here touches the DOM. ARCHITECTURE.md 4.10.
import type { SeenRow, Store } from '../types';

/** Pages a word must go by on, and different days among them, before it counts as known. */
export const AUTO_KNOWN_PAGES = 10;
export const AUTO_KNOWN_DAYS = 2;
/** The shortest time text has to stay on screen to count as read, and the time per character (25 characters a second at most). */
export const MIN_DWELL_MS = 3000;
export const MS_PER_CHAR = 40;
/** A tick never adds more than this, so a throttled timer or a sleeping device does not count as reading time. */
const MAX_TICK_MS = 2000;
/** How long before a text was first seen on screen a lookup still counts as made while reading it. */
const LOOKUP_GRACE_MS = 2000;

/** What the setting does, in the words Settings and the reader's pinyin menu use. */
export const AUTO_KNOWN_HELP = `A word you read past on ${AUTO_KNOWN_PAGES} pages over ${AUTO_KNOWN_DAYS} days without looking it up counts as known, and loses its pinyin in the Unknown and HSK pinyin modes. Looking it up takes it back off.`;

/** How long text of this many characters has to stay on screen to count as read. */
export function readingDwell(chars: number): number {
  return Math.max(MIN_DWELL_MS, chars * MS_PER_CHAR);
}

/** Days since 1970 in local time, so "a different day" means what it does on the person's clock. */
export function localDay(t: number): number {
  return Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 86400000);
}

/** A piece of text on screen: a block, or the part of a block on the pages on show. */
export interface ReadUnit {
  /** Stable for this piece while the reader stays open. */
  key: string;
  /** How long it has to stay on screen to count (see readingDwell). */
  needMs: number;
  /** Its Han words: an id per occurrence (unique while the reader is open) and the word as shown. */
  words(): { id: string; word: string }[];
}

export interface ReadView {
  /** Where the text on screen begins, as one increasing number: going back (a lower number) pauses counting. */
  top: number;
  /** How far back `top` may go without pausing (a small scroll up in the Scroll layout). */
  slack?: number;
  units: ReadUnit[];
}

export interface AutoKnownOptions {
  store: Pick<Store, 'known' | 'vocab' | 'seen'>;
  enabled(): boolean;
  /** The form words are counted and stored in (dict.toSimplified), so both scripts are one word. */
  simplify(word: string): string;
  now?(): number;
}

export interface AutoKnown {
  /** What is on screen now (null: nothing readable, or the page is hidden). Call about once a second. */
  tick(view: ReadView | null): void;
  /**
   * The person opened this word's card. A deliberate lookup (tap, click, keys) clears its count and takes a learned word off
   * the known list; a hover popup (`deliberate` false) only keeps the word from counting for the text on screen now.
   */
  lookedUp(word: string, deliberate?: boolean): void;
  /** Words read with help (a translated sentence): they do not count for the text on screen now. */
  helped(words: string[]): void;
  /** A new chapter was opened (the contents list, a link): counting starts again from there. */
  restart(): void;
  /** Resolves when the writes queued so far are done. */
  idle(): Promise<void>;
}

export function createAutoKnown(o: AutoKnownOptions): AutoKnown {
  const now = o.now ?? Date.now;
  const store = o.store;
  /** Time on screen so far for each unit in view, and when it came into view. */
  const dwell = new Map<string, { ms: number; since: number }>();
  /** Units that have counted, and word occurrences that have counted, while the reader is open. */
  const doneUnits = new Set<string>();
  const counted = new Set<string>();
  /** When each word (counting form) was last looked up or read with help. */
  const helpedAt = new Map<string, number>();
  let furthest = -Infinity;
  let last = 0;
  let queue: Promise<void> = Promise.resolve();

  const run = (fn: () => Promise<void>): Promise<void> => {
    queue = queue.then(fn).catch((e) => { console.warn('Dushu: could not update the words learned from reading', e); });
    return queue;
  };
  const simplify = (w: string) => { try { return o.simplify(w) || w; } catch { return w; } };

  /** One more page for each word; the ones that reach the bar become known and lose their count. One write each. */
  async function bump(words: string[], t: number): Promise<void> {
    const fresh = words.filter((w) => !store.known.has(w) && !store.vocab.has(w));
    if (!fresh.length) return;
    const today = localDay(t);
    const have = new Map((await store.seen.get(fresh)).map((r) => [r.word, r]));
    const put: SeenRow[] = [];
    const learned: string[] = [];
    for (const word of fresh) {
      const r = have.get(word);
      const next: SeenRow = r
        ? { word, n: r.n + 1, days: r.days + (r.lastDay === today ? 0 : 1), lastDay: today }
        : { word, n: 1, days: 1, lastDay: today };
      if (next.n >= AUTO_KNOWN_PAGES && next.days >= AUTO_KNOWN_DAYS) learned.push(word);
      else put.push(next);
    }
    if (put.length) await store.seen.put(put);
    if (learned.length) {
      await store.known.add(learned, { auto: true });
      await store.seen.remove(learned);
    }
  }

  return {
    tick(view) {
      const t = now();
      const dt = last ? Math.min(MAX_TICK_MS, Math.max(0, t - last)) : 0;
      last = t;
      if (!o.enabled()) { dwell.clear(); return; }
      if (!view) return; // hidden for a moment (another app, a chapter loading): the time on screen so far is kept
      // Going back to look at something is not reading on: nothing counts until the reader is back where they were.
      if (view.top < furthest - (view.slack ?? 0)) { dwell.clear(); return; }
      furthest = Math.max(furthest, view.top);
      const ready: { unit: ReadUnit; since: number }[] = [];
      const seen = new Set<string>();
      for (const unit of view.units) {
        seen.add(unit.key);
        if (doneUnits.has(unit.key)) continue;
        let d = dwell.get(unit.key);
        if (!d) { d = { ms: 0, since: t }; dwell.set(unit.key, d); }
        else d.ms += dt;
        if (d.ms >= unit.needMs) {
          doneUnits.add(unit.key);
          dwell.delete(unit.key);
          ready.push({ unit, since: d.since });
        }
      }
      // Text that left the screen starts again from nothing: flipping through pages never adds up to reading them.
      for (const key of [...dwell.keys()]) if (!seen.has(key)) dwell.delete(key);
      if (!ready.length) return;
      const words = new Set<string>();
      for (const { unit, since } of ready) {
        for (const { id, word } of unit.words()) {
          if (counted.has(id)) continue;
          counted.add(id);
          const key = simplify(word);
          const h = helpedAt.get(key);
          // The screen is sampled about once a second, so a lookup made just as the text appeared still belongs to it.
          if (h !== undefined && h >= since - LOOKUP_GRACE_MS) continue;
          words.add(key);
        }
      }
      if (words.size) void run(() => bump([...words], t));
    },

    lookedUp(word, deliberate = true) {
      if (!o.enabled() || !word) return;
      const key = simplify(word);
      helpedAt.set(key, now());
      if (!deliberate) return;
      void run(async () => {
        await store.seen.remove([key]);
        const forms = [...new Set([key, word])].filter((w) => store.known.has(w) && store.known.isAuto(w));
        if (forms.length) await store.known.remove(forms);
      });
    },

    helped(words) {
      if (!o.enabled()) return;
      const t = now();
      for (const w of words) if (w) helpedAt.set(simplify(w), t);
    },

    restart() {
      furthest = -Infinity;
      dwell.clear();
    },

    idle: () => queue,
  };
}
