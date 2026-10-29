// Chrome's built-in on-device Translator API (Chrome 138+ desktop).
// https://developer.chrome.com/docs/ai/translator-api
import type { TranslateRequest, Translator } from '../types';
import { chunkText } from './chunk';
import { isChinese, lang } from '../lang/active';

type ChromeAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'
  // Names used by earlier Chrome builds.
  | 'no' | 'after-download' | 'readily';

interface ChromeTranslatorInstance {
  translate(text: string, opts?: { signal?: AbortSignal }): Promise<string>;
  translateStreaming?(text: string, opts?: { signal?: AbortSignal }): ReadableStream<string>;
  destroy?(): void;
}

interface ChromeTranslatorStatic {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<ChromeAvailability>;
  create(opts: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
    signal?: AbortSignal;
  }): Promise<ChromeTranslatorInstance>;
}

/** The Chrome translator also lets the UI trigger the one-time model download from a click. */
export interface ChromeTranslator extends Translator {
  /** Call from a click handler. Downloads the model if needed; onProgress gets 0–1. */
  prepare(onProgress?: (fraction: number) => void): Promise<void>;
}

/** 'zh' or 'zh-Hant' for Chinese; another language's tag ('ja', 'es') when a book in it is open. */
type Source = string;
const langs = (sourceLanguage: Source) => ({ sourceLanguage, targetLanguage: 'en' });
/** The source a book other than Chinese translates from, or 'zh'. */
const baseSource = (): Source => (isChinese() ? 'zh' : lang().tag);

// Characters that differ between the scripts and are very common. A passage with more of one set than the other
// is in that script (a few shared or mixed-in characters do not matter).
const HANT_ONLY = new Set([...'們這個來說時會對國學為關開見經過還與麼樣體點嗎無從後書長東門問間認識鬥幾師話現當後見該請謝誰聽讓麼歲懷處總過還點樣門']);
const HANS_ONLY = new Set([...'们这个来说时会对国学为关开见经过还与么样体点吗无从后书长东门问间认识斗几师话现当该请谢谁听让岁怀处总']);

/** 'zh-Hant' when the text is mostly traditional characters, else 'zh'. */
export function sourceFor(text: string): Source {
  let hant = 0;
  let hans = 0;
  for (const ch of text.slice(0, 2000)) {
    if (HANT_ONLY.has(ch) && !HANS_ONLY.has(ch)) hant++;
    else if (HANS_ONLY.has(ch) && !HANT_ONLY.has(ch)) hans++;
  }
  return hant > hans ? 'zh-Hant' : 'zh';
}
/** Stay well under the model's input quota. */
const CHUNK = 1000;

function api(): ChromeTranslatorStatic | null {
  const t = (globalThis as { Translator?: ChromeTranslatorStatic }).Translator;
  return t && typeof t.availability === 'function' && typeof t.create === 'function' ? t : null;
}

export function chromeSupported(): boolean { return api() !== null; }

async function rawAvailability(source: Source = baseSource()): Promise<'yes' | 'download' | 'no'> {
  const t = api();
  if (!t) return 'no';
  try {
    // Chrome has been seen never to answer (headless, some profiles): after a few seconds it counts as not available.
    const a = await Promise.race([t.availability(langs(source)), new Promise<'unavailable'>((r) => setTimeout(() => r('unavailable'), 4000))]);
    if (a === 'available' || a === 'readily') return 'yes';
    if (a === 'downloadable' || a === 'downloading' || a === 'after-download') return 'download';
    return 'no';
  } catch {
    return 'no';
  }
}

/** One translator per source script: the model for traditional text is a different download from the simplified one. */
const instances = new Map<Source, Promise<ChromeTranslatorInstance>>();

function create(source: Source = baseSource(), onProgress?: (fraction: number) => void): Promise<ChromeTranslatorInstance> {
  const t = api();
  if (!t) return Promise.reject(new Error('This browser has no built-in translator. Use Chrome 138 or newer on a computer.'));
  const have = instances.get(source);
  if (have) return have;
  const p = t.create({
    ...langs(source),
    monitor(m) {
      m.addEventListener('downloadprogress', e => onProgress?.((e as Event & { loaded: number }).loaded));
    },
  }).catch((e: unknown) => {
    instances.delete(source); // let the next click try again
    const name = (e as { name?: string })?.name;
    if (name === 'NotAllowedError') throw new Error('Chrome needs a click to download the translation model. Press the download button in Settings.');
    if (name === 'NotSupportedError') throw new Error(`Chrome cannot translate ${isChinese() ? 'Chinese' : lang().name} to English on this device.`);
    throw new Error('Chrome could not start its translator: ' + ((e as Error)?.message ?? 'unknown error'));
  });
  instances.set(source, p);
  return p;
}

/** Drops the cached instance (tests, and after a failed download). */
export function resetChromeTranslator(): void {
  for (const p of instances.values()) p.then(i => i.destroy?.()).catch(() => {});
  instances.clear();
}

function aborted(): never {
  throw new DOMException('Translation canceled', 'AbortError');
}

async function translateOne(
  tr: ChromeTranslatorInstance,
  text: string,
  signal: AbortSignal | undefined,
  onPart: ((so: string) => void) | undefined,
): Promise<string> {
  if (onPart && tr.translateStreaming) {
    let acc = '';
    const reader = tr.translateStreaming(text, { signal }).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += value;
      onPart(acc);
    }
    return acc;
  }
  return tr.translate(text, { signal });
}

export function createChromeTranslator(): ChromeTranslator {
  return {
    id: 'chrome',
    label: 'Chrome on-device',
    availability: () => rawAvailability(),
    async prepare(onProgress) {
      await create(baseSource(), onProgress);
    },
    async translate(req: TranslateRequest, opts) {
      const signal = opts?.signal;
      if (signal?.aborted) aborted();
      const state = await rawAvailability();
      if (state === 'no') throw new Error('Chrome\'s on-device translator is not available here.');
      // 'download' only works inside a click; create() reports NotAllowedError otherwise.
      // Traditional text uses the zh-Hant model when it is ready; otherwise the plain zh one, as before.
      const source: Source = !isChinese() ? baseSource() : sourceFor(req.text) === 'zh-Hant' && (await rawAvailability('zh-Hant')) === 'yes' ? 'zh-Hant' : 'zh';
      const tr = await create(source);
      const chunks = chunkText(req.text, CHUNK);
      let done = '';
      for (const c of chunks) {
        if (signal?.aborted) aborted();
        const prefix = done;
        const part = await translateOne(tr, c, signal, opts?.onDelta
          ? so => opts.onDelta!(prefix + so) : undefined);
        done = prefix ? prefix + ' ' + part.trim() : part.trim();
        opts?.onDelta?.(done);
      }
      return done;
    },
  };
}
