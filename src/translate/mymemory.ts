// MyMemory free translation API. Sends the selected text to a third party, so the user opts in.
// CORS: the API answers with `access-control-allow-origin: *` (checked with curl), so browsers can call it.
// Never add the `de=` email parameter.
import type { TranslateRequest, Translator } from '../types';
import { chunkText } from './chunk';

const ENDPOINT = 'https://api.mymemory.translated.net/get';
const MAX_CHUNK = 500;

export const QUOTA_MESSAGE = 'MyMemory\'s free daily limit is used up. Try again tomorrow, or pick a different translator in Settings.';

interface MyMemoryReply {
  responseData?: { translatedText?: string };
  quotaFinished?: boolean;
  responseStatus?: number | string;
  responseDetails?: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[name.toLowerCase()] ?? m;
  });
}

async function translateChunk(
  chunk: string,
  signal: AbortSignal | undefined,
  fetchFn: typeof fetch,
): Promise<string> {
  const url = `${ENDPOINT}?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent('zh-CN|en')}`;
  let res: Response;
  try {
    res = await fetchFn(url, { signal });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new Error('Could not reach MyMemory. Check your connection.');
  }
  if (res.status === 429) throw new Error(QUOTA_MESSAGE);
  let body: MyMemoryReply;
  try {
    body = await res.json();
  } catch {
    throw new Error(`MyMemory sent a reply that could not be read (HTTP ${res.status}).`);
  }
  const text = body.responseData?.translatedText ?? '';
  const status = Number(body.responseStatus ?? res.status);
  if (body.quotaFinished || status === 429 || /MYMEMORY WARNING/i.test(text) || /used all available free/i.test(body.responseDetails ?? '')) {
    throw new Error(QUOTA_MESSAGE);
  }
  if (status !== 200 || !res.ok) {
    throw new Error('MyMemory could not translate this: ' + (body.responseDetails || `error ${status}`));
  }
  return decodeEntities(text).trim();
}

export function createMyMemoryTranslator(deps: { fetch?: typeof fetch } = {}): Translator {
  const fetchFn = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    id: 'mymemory',
    label: 'MyMemory (online, free)',
    async availability() {
      return typeof navigator !== 'undefined' && navigator.onLine === false ? 'no' : 'yes';
    },
    async translate(req: TranslateRequest, opts) {
      const parts: string[] = [];
      for (const chunk of chunkText(req.text, MAX_CHUNK)) {
        if (opts?.signal?.aborted) throw new DOMException('Translation canceled', 'AbortError');
        parts.push(await translateChunk(chunk, opts?.signal, fetchFn));
        opts?.onDelta?.(parts.join(' '));
      }
      return parts.join(' ');
    },
  };
}
