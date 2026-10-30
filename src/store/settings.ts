// Settings in localStorage. Unknown keys are dropped, bad types reset, numbers clamped.
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from '../translate/claudePrompts';
import { DEFAULT_TARGET, TARGET_CODES } from '../translate/targets';
import type { Settings, SettingsStore } from '../types';
import { cleanCovers } from '../core/covers';
import type { LangId } from '../lang/types';

export const SETTINGS_KEY = 'dushu.settings.v1';
const CHINESE_KEY = SETTINGS_KEY;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  fontFamily: 'serif',
  fontSize: 22,
  scrollFontSize: 28,
  lineHeight: 2.1,
  pageWidth: 760,
  pinyin: 'unknown',
  hskThreshold: 3,
  pinyinStyle: 'marks',
  toneColors: true,
  sandhi: true,
  autoKnown: false,
  script: 'simplified',
  lookupTrigger: 'click',
  paragraphTranslate: true,
  translator: 'auto',
  claudeModel: DEFAULT_CLAUDE_MODEL,
  localOnly: false,
  translateTo: DEFAULT_TARGET,
  ttsVoice: '',
  ttsRate: 0.9,
  layout: 'pages',
  spread: 'auto',
  pageTurn: 'slide',
  covers: '',
};

type Rule = (v: unknown) => unknown | undefined; // returns the clean value, or undefined if unusable

const oneOf = (...allowed: string[]): Rule => (v) => (typeof v === 'string' && allowed.includes(v) ? v : undefined);
const bool: Rule = (v) => (typeof v === 'boolean' ? v : undefined);
const num = (min: number, max: number, digits: number): Rule => (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const f = 10 ** digits;
  return Math.round(Math.min(max, Math.max(min, v)) * f) / f;
};
const text = (maxLen: number, allowEmpty: boolean): Rule => (v) => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, maxLen);
  return t || allowEmpty ? t : undefined;
};

const RULES: { [K in keyof Settings]-?: Rule } = {
  theme: oneOf('system', 'light', 'sepia', 'dark'),
  fontFamily: oneOf('serif', 'sans', 'kai'),
  fontSize: num(14, 44, 0),
  scrollFontSize: num(14, 44, 0),
  lineHeight: num(1.4, 3, 2),
  pageWidth: num(480, 1200, 0),
  pinyin: oneOf('off', 'all', 'unknown', 'hsk'),
  hskThreshold: num(1, 7, 0),
  pinyinStyle: oneOf('marks', 'numbers', 'zhuyin'),
  toneColors: bool,
  sandhi: bool,
  autoKnown: bool,
  script: oneOf('original', 'simplified', 'traditional'),
  lookupTrigger: oneOf('click', 'hover'),
  paragraphTranslate: bool,
  translator: oneOf('auto', 'local', 'chrome', 'claude', 'account', 'mymemory', 'gloss'),
  claudeModel: oneOf(...CLAUDE_MODELS.map(m => m.value)),
  localOnly: bool,
  translateTo: oneOf(...TARGET_CODES),
  ttsVoice: text(200, true),
  ttsRate: num(0.5, 2, 2),
  layout: oneOf('scroll', 'pages'),
  spread: oneOf('auto', 'single', 'double'),
  pageTurn: oneOf('flip', 'slide', 'none'),
  covers: cleanCovers,
  stress: bool,
};

const KEYS = Object.keys(RULES) as (keyof Settings)[];

/** Text-size controls and rendering always use the current layout's saved size. */
export function readingFontSizeKey(s: Settings): 'fontSize' | 'scrollFontSize' {
  return s.layout === 'scroll' ? 'scrollFontSize' : 'fontSize';
}

/** A complete, valid Settings from untrusted input: bad or missing fields fall back to defaults. */
export function sanitizeSettings(raw: unknown, defaults: Settings = DEFAULT_SETTINGS): Settings {
  const out: Record<string, unknown> = { ...defaults };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const src = raw as Record<string, unknown>;
    for (const k of KEYS) {
      const clean = RULES[k](Object.prototype.hasOwnProperty.call(src, k) ? src[k] : undefined);
      if (clean !== undefined) out[k] = clean;
    }
  }
  return out as unknown as Settings;
}

/** Only the valid fields of a partial update; invalid values and unknown keys are left out. */
export function sanitizePatch(raw: unknown): Partial<Settings> {
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const src = raw as Record<string, unknown>;
    for (const k of KEYS) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      const clean = RULES[k](src[k]);
      if (clean !== undefined) out[k] = clean;
    }
  }
  return out as Partial<Settings>;
}

function defaultStorage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; } // access can throw when site data is blocked
}

/**
 * The defaults for a language other than Chinese: no hints over words until asked for (Japanese shows furigana over the
 * words you have not marked known, like pinyin), and no Kai face, which only Chinese has.
 */
export function defaultsFor(id: LangId): Settings {
  if (id === 'zh') return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, stress: true, pinyin: id === 'ja' ? 'unknown' : 'off', hskThreshold: 2, script: 'original', fontSize: id === 'ja' ? 22 : 21, scrollFontSize: id === 'ja' ? 26 : 23, lineHeight: id === 'ja' ? 2 : 1.6, sandhi: false };
}

function load(storage: Storage | undefined, key: string, defaults: Settings): Settings {
  try {
    const raw = storage?.getItem(key);
    if (raw) {
      const clean = sanitizeSettings(JSON.parse(raw), defaults);
      // Older versions kept an Anthropic key here. The key now lives only on the Mac, so rewrite the entry without it.
      if (raw.includes('claudeApiKey')) { try { storage?.setItem(key, JSON.stringify(clean)); } catch { /* read-only storage */ } }
      return clean;
    }
  } catch { /* corrupt JSON or blocked storage: use defaults */ }
  return { ...defaults };
}

/**
 * The language sentences are translated into, for the whole device. Every language's library has its own settings, but this
 * one is the reader's: French picked while reading Chinese is French in the Spanish library too. Each store reads it when it
 * opens and writes it when it changes, so the last choice made in any library is the one every library starts from. Not
 * under a language's prefix (dushu.<id>.), so deleting one language's library leaves it alone, and neither does Chinese
 * "Erase all data" (the other libraries still read it). Held as {"to":"fr","at":<ms>}: `at` is when it was chosen, which
 * sync stamps the Chinese library's change with (chosenAt), since only that library syncs and it may open days later.
 */
export const TARGET_KEY = 'dushu.translate-to.v1';

function sharedTarget(storage: Storage | undefined): { to: string; at?: number } | undefined {
  try {
    const raw = storage?.getItem(TARGET_KEY);
    if (!raw) return undefined;
    // A bare code ("fr") is what the key held before it kept the time: a choice with no time.
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    const v = (typeof parsed === 'string' ? { to: parsed } : parsed) as { to?: unknown; at?: unknown } | null;
    if (!v || typeof v.to !== 'string' || !TARGET_CODES.includes(v.to)) return undefined;
    return { to: v.to, ...(typeof v.at === 'number' && Number.isFinite(v.at) ? { at: v.at } : {}) };
  } catch { return undefined; } // blocked storage or a value that is not ours: the library's own value stands
}

/** Set once a device has moved to simplified characters, the default since 2026-10-24 (before, it was "As written"). */
const SIMPLIFIED_KEY = 'dushu.settings.simplified.v1';
/** Set once a device has moved to the Pages layout (reading like a book), the default since 2026-10-25 (before, Scroll). */
const PAGES_KEY = 'dushu.settings.pages.v1';
/** Set once a device has moved to sliding pages, the default since 2026-10-26 (before, Flip). */
const SLIDE_KEY = 'dushu.settings.slide.v1';

/**
 * `id` is the language the page reads: Chinese keeps dushu.settings.v1, another language its own key (langKey), so a
 * Japanese reader's furigana choice never changes how Chinese shows pinyin.
 */
export function createSettingsStore(storage: Storage | undefined = defaultStorage(), id: LangId = 'zh'): SettingsStore {
  const SETTINGS_KEY = id === 'zh' ? CHINESE_KEY : CHINESE_KEY.replace(/^dushu\./, `dushu.${id}.`);
  const defaults = defaultsFor(id);
  let s = load(storage, SETTINGS_KEY, defaults);
  // Saved settings hold every value, so a device that kept the old default ("As written") moves to simplified once; a
  // later choice of "As written" stays. (Chinese only: the other languages started with today's defaults.)
  if (id === 'zh') try {
    if (storage && !storage.getItem(SIMPLIFIED_KEY)) {
      if (s.script === 'original' && storage.getItem(SETTINGS_KEY)) {
        s = { ...s, script: 'simplified' };
        storage.setItem(SETTINGS_KEY, JSON.stringify(s));
      }
      storage.setItem(SIMPLIFIED_KEY, '1');
    }
    if (storage && !storage.getItem(PAGES_KEY)) {
      if (s.layout === 'scroll' && storage.getItem(SETTINGS_KEY)) {
        s = { ...s, layout: 'pages' };
        storage.setItem(SETTINGS_KEY, JSON.stringify(s));
      }
      storage.setItem(PAGES_KEY, '1');
    }
    if (storage && !storage.getItem(SLIDE_KEY)) {
      if (s.pageTurn === 'flip' && storage.getItem(SETTINGS_KEY)) {
        s = { ...s, pageTurn: 'slide' };
        storage.setItem(SETTINGS_KEY, JSON.stringify(s));
      }
      storage.setItem(SLIDE_KEY, '1');
    }
  } catch { /* read-only storage: the saved choice stands */ }
  // The reader's language as last chosen in any library (a store that never had one keeps English).
  const shared = sharedTarget(storage)?.to;
  if (shared && shared !== s.translateTo) s = { ...s, translateTo: shared };
  const subs = new Set<(s: Settings, changed: (keyof Settings)[]) => void>();
  const notify = (changed: (keyof Settings)[]) => {
    for (const fn of [...subs]) {
      try { fn(s, changed); } catch (e) { console.error('settings subscriber failed', e); }
    }
  };

  // Another tab changed settings: pick them up.
  if (storage && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('storage', (e: Event) => {
      const ev = e as StorageEvent;
      if (ev.storageArea !== storage || (ev.key !== SETTINGS_KEY && ev.key !== TARGET_KEY && ev.key !== null)) return;
      const next = load(storage, SETTINGS_KEY, defaults);
      // A tab reading another language changed the reader's language: this library follows.
      next.translateTo = sharedTarget(storage)?.to ?? next.translateTo;
      const changed = KEYS.filter((k) => next[k] !== s[k]);
      s = next;
      if (changed.length) notify(changed);
    });
  }

  return {
    get: () => s,
    set(patch) {
      const clean = sanitizePatch(patch);
      const changed = KEYS.filter((k) => k in clean && clean[k] !== s[k]);
      s = { ...s, ...clean };
      try {
        storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
        if (changed.includes('translateTo')) storage?.setItem(TARGET_KEY, JSON.stringify({ to: s.translateTo, at: Date.now() }));
      } catch { /* private mode or quota: keep in memory */ }
      notify(changed);
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    chosenAt(name) {
      if (name !== 'translateTo') return undefined;
      const shared = sharedTarget(storage);
      return shared?.to === s.translateTo ? shared.at : undefined;
    },
  };
}
