// Settings in localStorage. Unknown keys are dropped, bad types reset, numbers clamped.
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from '../translate/claudePrompts';
import type { Settings, SettingsStore } from '../types';

export const SETTINGS_KEY = 'dushu.settings.v1';

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
  ttsVoice: '',
  ttsRate: 0.9,
  layout: 'pages',
  spread: 'auto',
  pageTurn: 'slide',
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

const RULES: { [K in keyof Settings]: Rule } = {
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
  translator: oneOf('auto', 'local', 'chrome', 'claude', 'mymemory', 'gloss'),
  claudeModel: oneOf(...CLAUDE_MODELS.map(m => m.value)),
  localOnly: bool,
  ttsVoice: text(200, true),
  ttsRate: num(0.5, 2, 2),
  layout: oneOf('scroll', 'pages'),
  spread: oneOf('auto', 'single', 'double'),
  pageTurn: oneOf('flip', 'slide', 'none'),
};

const KEYS = Object.keys(RULES) as (keyof Settings)[];

/** Text-size controls and rendering always use the current layout's saved size. */
export function readingFontSizeKey(s: Settings): 'fontSize' | 'scrollFontSize' {
  return s.layout === 'scroll' ? 'scrollFontSize' : 'fontSize';
}

/** A complete, valid Settings from untrusted input: bad or missing fields fall back to defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
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

function load(storage: Storage | undefined): Settings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (raw) {
      const clean = sanitizeSettings(JSON.parse(raw));
      // Older versions kept an Anthropic key here. The key now lives only on the Mac, so rewrite the entry without it.
      if (raw.includes('claudeApiKey')) { try { storage?.setItem(SETTINGS_KEY, JSON.stringify(clean)); } catch { /* read-only storage */ } }
      return clean;
    }
  } catch { /* corrupt JSON or blocked storage: use defaults */ }
  return { ...DEFAULT_SETTINGS };
}

/** Set once a device has moved to simplified characters, the default since 2026-10-24 (before, it was "As written"). */
const SIMPLIFIED_KEY = 'dushu.settings.simplified.v1';
/** Set once a device has moved to the Pages layout (reading like a book), the default since 2026-10-25 (before, Scroll). */
const PAGES_KEY = 'dushu.settings.pages.v1';
/** Set once a device has moved to sliding pages, the default since 2026-10-26 (before, Flip). */
const SLIDE_KEY = 'dushu.settings.slide.v1';

export function createSettingsStore(storage: Storage | undefined = defaultStorage()): SettingsStore {
  let s = load(storage);
  // Saved settings hold every value, so a device that kept the old default ("As written") moves to simplified once; a
  // later choice of "As written" stays.
  try {
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
      if (ev.storageArea !== storage || (ev.key !== SETTINGS_KEY && ev.key !== null)) return;
      const next = load(storage);
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
      try { storage?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode or quota: keep in memory */ }
      notify(changed);
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
