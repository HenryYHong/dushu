// Chrome's built-in on-device Translator API (Chrome 138+ desktop).
// https://developer.chrome.com/docs/ai/translator-api
import type { TranslateRequest, Translator } from '../types';
import { chunkText } from './chunk';

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

const LANGS = { sourceLanguage: 'zh', targetLanguage: 'en' };
/** Stay well under the model's input quota. */
const CHUNK = 1000;

function api(): ChromeTranslatorStatic | null {
  const t = (globalThis as { Translator?: ChromeTranslatorStatic }).Translator;
  return t && typeof t.availability === 'function' && typeof t.create === 'function' ? t : null;
}

export function chromeSupported(): boolean { return api() !== null; }

async function rawAvailability(): Promise<'yes' | 'download' | 'no'> {
  const t = api();
  if (!t) return 'no';
  try {
    const a = await t.availability(LANGS);
    if (a === 'available' || a === 'readily') return 'yes';
    if (a === 'downloadable' || a === 'downloading' || a === 'after-download') return 'download';
    return 'no';
  } catch {
    return 'no';
  }
}

let instance: Promise<ChromeTranslatorInstance> | null = null;

function create(onProgress?: (fraction: number) => void): Promise<ChromeTranslatorInstance> {
  const t = api();
  if (!t) return Promise.reject(new Error('This browser has no built-in translator. Use Chrome 138 or newer on a computer.'));
  if (instance) return instance;
  const p = t.create({
    ...LANGS,
    monitor(m) {
      m.addEventListener('downloadprogress', e => onProgress?.((e as Event & { loaded: number }).loaded));
    },
  }).catch((e: unknown) => {
    instance = null; // let the next click try again
    const name = (e as { name?: string })?.name;
    if (name === 'NotAllowedError') throw new Error('Chrome needs a click to download the translation model. Press the download button in Settings.');
    if (name === 'NotSupportedError') throw new Error('Chrome cannot translate Chinese to English on this device.');
    throw new Error('Chrome could not start its translator: ' + ((e as Error)?.message ?? 'unknown error'));
  });
  instance = p;
  return p;
}

/** Drops the cached instance (tests, and after a failed download). */
export function resetChromeTranslator(): void {
  instance?.then(i => i.destroy?.()).catch(() => {});
  instance = null;
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
    availability: rawAvailability,
    async prepare(onProgress) {
      await create(onProgress);
    },
    async translate(req: TranslateRequest, opts) {
      const signal = opts?.signal;
      if (signal?.aborted) aborted();
      const state = await rawAvailability();
      if (state === 'no') throw new Error('Chrome\'s on-device translator is not available here.');
      // 'download' only works inside a click; create() reports NotAllowedError otherwise.
      const tr = await create();
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
