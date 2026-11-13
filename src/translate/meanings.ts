// A word card's meanings in the reader's language. The dictionaries explain words in English (CC-CEDICT, JMdict, Wiktionary), or
// in Chinese in the English library (ECDICT). A reader whose language is another one gets each meaning the card shows translated
// into it: from the dictionary's language, not the book's (en>fr for a French reader of Spanish books, zh>ko for a Korean reader
// of English ones). The dictionary's own words stay the authority; the card shows them under each translation
// (ui/popup/meanings.ts). Contract: ARCHITECTURE.md §4.7.
//
// Which translator: Chrome's on-device one first (free, private, and it runs without asking), then the reader's chosen online
// one, then Qwen through the account and Claude (the owner's, which costs money). MyMemory only when the reader chose it for
// sentences, as Automatic never sends a sentence to it either. Every answer is kept (by translator, language pair and text), so
// a word looked up again costs nothing.
import type { Settings } from '../types';
import type { LangId } from '../lang/types';
import { langId } from '../lang/active';
import { glossCode, readerOf, readsOwnLanguage } from '../lang/ownDictionary';
import { chromePair } from './chrome';
import { createClaudeTranslator } from './claude';
import { createAccountTranslator } from './account';
import { myMemoryText } from './mymemory';
import { ACCOUNT_TEXT } from './prompt';
import { targetFor } from './targets';
import { tt } from '../i18n';

export type MeaningsMode = Settings['translateMeanings'];
export type MeaningProviderId = 'chrome' | 'account' | 'claude' | 'mymemory';

/**
 * The language a library's dictionary explains words in for this reader (lang/ownDictionary.ts): the book's own language for
 * someone who speaks it (English books for anyone), ECDICT's Chinese for a Chinese speaker reading English, else English.
 */
export const dictionaryLanguage = (id: LangId = langId(), reader?: string): string => glossCode(id, reader);

/**
 * The language a card's meanings go into, or null when they stay as the dictionary has them: the setting says Never, or the
 * reader's language (the one sentences go into, targetFor) is the dictionary's own: English for an English speaker reading
 * Spanish, Chinese (either script) for a Chinese speaker reading English.
 */
export function meaningsTarget(settings: Pick<Settings, 'translateTo' | 'translateMeanings'>, id: LangId = langId()): string | null {
  const reader = readerOf(settings.translateTo);
  if (settings.translateMeanings === 'never' || readsOwnLanguage(id, reader)) return null;
  const to = targetFor(settings.translateTo, id);
  return to.split('-')[0] === dictionaryLanguage(id, reader) ? null : to;
}

export interface MeaningProvider {
  id: MeaningProviderId;
  readonly label: string;
  /** Free and on this device: Automatic runs it without asking. */
  onDevice: boolean;
  availability(): Promise<'yes' | 'download' | 'no'>;
  /** Chrome's one-time model download, from a click. */
  prepare?(onProgress?: (fraction: number) => void): Promise<void>;
  /** Each text in the target language, in order: one answer per text, never two merged or one split. */
  translate(texts: string[], signal?: AbortSignal): Promise<string[]>;
}

// ---------------------------------------------------------------- batches ---

/**
 * Several meanings as one request to a language model: numbered lines, so the answer splits back into the same meanings. The
 * servers' sentence prompts translate a passage line for line (a poem keeps its lines), and keep "1." as written.
 */
export function numbered(texts: readonly string[]): string {
  return texts.map((t, i) => `${i + 1}. ${t.replace(/\s*\n\s*/g, ' ').trim()}`).join('\n');
}

/** The first digit of each run of ten decimal digits that answers may number lines with (full-width, Arabic, Devanagari…). */
const DIGIT_ZEROS = [0x30, 0xff10, 0x660, 0x6f0, 0x966, 0x9e6, 0xe50, 0x1040];
const asciiDigits = (s: string): string => s.replace(/\p{Nd}/gu, (d) => {
  const cp = d.codePointAt(0)!;
  const zero = DIGIT_ZEROS.find((z) => cp >= z && cp < z + 10);
  return zero === undefined ? d : String(cp - zero);
});
const NUMBERED_LINE = /^\(?(\d{1,3})\s*[.)．。、:：\-–)）]\s*(.*)$/u;

/** The answer to numbered(), one text per number in order, or null when it did not keep the meanings apart. */
export function unnumbered(answer: string, n: number): string[] | null {
  const lines = answer.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: (string | undefined)[] = new Array(n).fill(undefined);
  let found = 0;
  for (const line of lines) {
    const m = NUMBERED_LINE.exec(asciiDigits(line));
    if (!m) continue;
    const i = Number(m[1]) - 1;
    const text = line.slice(line.length - m[2].length).trim();
    if (i < 0 || i >= n || out[i] !== undefined || !text) return null;
    out[i] = text;
    found++;
  }
  if (found === n) return out as string[];
  // No numbers kept: one line per meaning still lines up, and a single meaning is the whole answer.
  if (found === 0 && lines.length === n) return lines;
  if (found === 0 && n === 1 && lines.length) return [lines.join(' ')];
  return null;
}

/** Texts in runs whose numbered() form stays under `max` characters (a request's limit), each text whole. */
export function batches(texts: readonly string[], max: number): string[][] {
  const out: string[][] = [];
  let run: string[] = [];
  for (const t of texts) {
    const next = [...run, t];
    if (run.length && numbered(next).length > max) { out.push(run); run = [t]; } else run = next;
  }
  if (run.length) out.push(run);
  return out;
}

const aborted = (): never => { throw new DOMException('Translation canceled', 'AbortError'); };

const SPLIT_FAILED = () => new Error(tt('The translation did not keep the meanings apart. Try again.'));

// -------------------------------------------------------------- providers ---

/** The translator `id` for meanings from `from` into `to`. */
export function meaningProvider(id: MeaningProviderId, settings: Settings, from: string, to: string): MeaningProvider {
  switch (id) {
    case 'chrome': {
      // Chrome names Chinese 'zh' and translates each text on the device: one call per meaning keeps them apart for free.
      const pair = chromePair(from, to);
      return {
        id, onDevice: true,
        get label() { return tt('Chrome on-device'); },
        availability: () => pair.availability(),
        prepare: (onProgress) => pair.prepare(onProgress),
        async translate(texts, signal) {
          return Promise.all(texts.map((t) => pair.translate(t, signal)));
        },
      };
    }
    case 'mymemory':
      return {
        id, onDevice: false,
        get label() { return tt('MyMemory (online, free)'); },
        async availability() {
          if (settings.localOnly) return 'no';
          return typeof navigator !== 'undefined' && navigator.onLine === false ? 'no' : 'yes';
        },
        // Its limit counts characters, not requests, and its memory matches a whole segment ("house" has a human translation,
        // "1. house" does not), so each meaning goes on its own.
        async translate(texts, signal) {
          const out: string[] = [];
          for (const t of texts) {
            if (signal?.aborted) aborted();
            out.push(await myMemoryText(t, from, to, { signal }));
          }
          return out;
        },
      };
    case 'claude':
    case 'account': {
      // The servers build the prompt; a request names the dictionary's language as a book in it would (lang 'en', or none for
      // Chinese) and the reader's as `to`. One request for the card, the meanings numbered.
      const translator = id === 'claude' ? createClaudeTranslator(settings, { source: from as LangId }) : createAccountTranslator(settings, from as LangId);
      const max = id === 'account' ? ACCOUNT_TEXT - 50 : 3000;
      return {
        id, onDevice: false,
        get label() { return translator.label; },
        availability: () => translator.availability(),
        async translate(texts, signal) {
          const out: string[] = [];
          for (const run of batches(texts, max)) {
            if (signal?.aborted) aborted();
            let other = false;
            const answer = await translator.translate({ text: numbered(run), mode: 'translate', to }, { signal, onInto: () => { other = true; } });
            // A server from before the reader's language answers in another one: that is not a translation into theirs.
            if (other) throw new Error(tt('The server that translates these needs an update to translate into your language.'));
            const split = unnumbered(answer, run.length);
            if (!split) throw SPLIT_FAILED();
            out.push(...split);
          }
          return out;
        },
      };
    }
  }
}

export interface MeaningPick {
  provider: MeaningProvider;
  availability: 'yes' | 'download';
  /** Translate at once: the setting allows this translator without a click. */
  auto: boolean;
}

/** The translators to try, in order: Chrome on the device, the reader's chosen online one, Qwen through the account, Claude. */
export function meaningOrder(settings: Pick<Settings, 'translator'>): MeaningProviderId[] {
  const chosen = settings.translator;
  const ids: MeaningProviderId[] = ['chrome'];
  if (chosen === 'claude' || chosen === 'account' || chosen === 'mymemory') ids.push(chosen);
  for (const id of ['account', 'claude'] as const) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/**
 * The translator a card uses, and whether it starts at once: Automatic runs Chrome on the device when it is ready and offers the
 * first other one on a button; Always runs the first one ready; When I ask offers the first one. Null when none can run here
 * (Safari with no account and no Mac, or Local only without Chrome), or the setting is Never.
 */
export async function pickMeaningProvider(
  settings: Settings, from: string, to: string,
  make: typeof meaningProvider = meaningProvider,
): Promise<MeaningPick | null> {
  const mode = settings.translateMeanings;
  if (mode === 'never') return null;
  let offer: MeaningPick | null = null;
  for (const id of meaningOrder(settings)) {
    const provider = make(id, settings, from, to);
    let availability: 'yes' | 'download' | 'no';
    try { availability = await provider.availability(); } catch { availability = 'no'; }
    if (availability === 'no') continue;
    if (availability === 'yes' && (mode === 'always' || (mode === 'auto' && provider.onDevice))) return { provider, availability, auto: true };
    offer ??= { provider, availability, auto: false };
    // Only Always goes on looking for one that can start by itself (an online one while Chrome waits for its download).
    if (mode !== 'always') return offer;
  }
  return offer;
}

// ------------------------------------------------------------------ cache ---

/**
 * Translated meanings, by translator, pair and text, on this device: [key, translation] pairs, oldest first. Bounded by count
 * and by characters (about 300 KB of storage at most), the oldest dropped first; a meaning used again moves to the end.
 */
export const MEANINGS_KEY = 'dushu.meanings.v1';
const MAX_ENTRIES = 2000;
const MAX_CHARS = 150_000;

let memo: Map<string, string> | null = null;
let chars = 0;

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function cache(): Map<string, string> {
  if (memo) return memo;
  memo = new Map();
  chars = 0;
  try {
    const raw = JSON.parse(storage()?.getItem(MEANINGS_KEY) ?? '[]') as unknown;
    if (Array.isArray(raw)) {
      for (const e of raw) {
        if (Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string') { memo.set(e[0], e[1]); chars += e[0].length + e[1].length; }
      }
    }
  } catch { /* nothing kept, or not ours: start empty */ }
  trim();
  return memo;
}

function trim(): void {
  if (!memo) return;
  for (const [k, v] of memo) {
    if (memo.size <= MAX_ENTRIES && chars <= MAX_CHARS) break;
    memo.delete(k);
    chars -= k.length + v.length;
  }
}

const keyOf = (id: MeaningProviderId, from: string, to: string, text: string) => `${id}|${from}>${to}|${text}`;

/** A meaning translated before, or undefined. */
export function cachedMeaning(id: MeaningProviderId, from: string, to: string, text: string): string | undefined {
  const c = cache();
  const key = keyOf(id, from, to, text);
  const v = c.get(key);
  if (v !== undefined) { c.delete(key); c.set(key, v); }
  return v;
}

/** Keeps translated meanings, and writes them down (blocked or full storage: this visit only). */
export function keepMeanings(id: MeaningProviderId, from: string, to: string, pairs: readonly (readonly [string, string])[]): void {
  const c = cache();
  for (const [text, translated] of pairs) {
    if (!translated) continue;
    const key = keyOf(id, from, to, text);
    const old = c.get(key);
    if (old !== undefined) { c.delete(key); chars -= key.length + old.length; }
    c.set(key, translated);
    chars += key.length + translated.length;
  }
  trim();
  try { storage()?.setItem(MEANINGS_KEY, JSON.stringify([...c])); } catch { /* kept in memory */ }
}

/** Forgets what was kept in memory (tests; the storage is read again on the next use). */
export function resetMeaningsCache(): void { memo = null; chars = 0; }

/** The meanings of `texts` that any translator gave before, by text, with the translator: free to show again. */
export function cachedAny(texts: readonly string[], from: string, to: string, order: readonly MeaningProviderId[]): Map<string, { text: string; id: MeaningProviderId }> {
  const out = new Map<string, { text: string; id: MeaningProviderId }>();
  const ids = [...new Set<MeaningProviderId>([...order, 'chrome', 'account', 'claude', 'mymemory'])];
  for (const t of texts) {
    for (const id of ids) {
      const v = cachedMeaning(id, from, to, t);
      if (v !== undefined) { out.set(t, { text: v, id }); break; }
    }
  }
  return out;
}

/** `texts` through `provider`: what it gave before from the cache, the rest in one go (each text once), then kept. */
export async function translateMeanings(provider: MeaningProvider, texts: readonly string[], from: string, to: string, signal?: AbortSignal): Promise<string[]> {
  const out = texts.map((t) => cachedMeaning(provider.id, from, to, t));
  const missing = [...new Set(texts.filter((_, i) => out[i] === undefined))];
  if (missing.length) {
    const got = await provider.translate(missing, signal);
    if (signal?.aborted) aborted();
    if (got.length !== missing.length) throw SPLIT_FAILED();
    const pairs = missing.map((t, i) => [t, got[i]?.trim() ?? ''] as const);
    keepMeanings(provider.id, from, to, pairs);
    const by = new Map(pairs);
    texts.forEach((t, i) => { if (out[i] === undefined) out[i] = by.get(t) ?? ''; });
  }
  return out as string[];
}
