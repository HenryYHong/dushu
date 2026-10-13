// Shared pieces of the translation evaluation: passages, the book lexicons the reader would have, model callers
// (Claude from Node with the key file, Ollama), a disk cache and a small work pool.
// The API key is read from ~/.config/dushu/anthropic-api-key at call time and only ever goes to the SDK client.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const EVAL_DIR = join(ROOT, 'scripts/eval');
export const CACHE_DIR = join(ROOT, '.cache/eval');
const KEY_FILE = join(homedir(), '.config/dushu/anthropic-api-key');

export const MODELS = { sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', qwen: 'qwen3.5:9b-q4_K_M' };

const sha = value => createHash('sha1').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const readJson = async name => JSON.parse(await readFile(join(EVAL_DIR, name), 'utf8'));

/** Run `fn` over `items` with at most `limit` in flight; results keep their order. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Disk cache keyed by the exact request, so re-running the evaluation costs nothing unless something changed. */
export async function cached(kind, request, produce, { fresh = false } = {}) {
  const file = join(CACHE_DIR, kind, `${sha(request)}.json`);
  if (!fresh && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const value = await produce();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
  return value;
}

// ---------------------------------------------------------------- Claude ---

let clientPromise;
async function claudeClient() {
  clientPromise ??= (async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    // Read at request time; never printed, never stored anywhere but the SDK client.
    const apiKey = (await readFile(KEY_FILE, 'utf8')).trim();
    return new Anthropic({ apiKey, maxRetries: 3, timeout: 90_000 });
  })();
  return clientPromise;
}

/** One streamed Claude call. Returns text, time to first token, total time and token counts; errors are values. */
export async function callClaude({ model, system, user, effort = 'low', maxTokens = 1600, fallback = true }) {
  const client = await claudeClient();
  const start = Date.now();
  let firstMs = null;
  try {
    const body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
    if (effort) body.output_config = { effort };
    if (fallback && model === MODELS.sonnet) { body.betas = ['server-side-fallback-2026-07-01']; body.fallbacks = 'default'; }
    const stream = client.beta.messages.stream(body);
    stream.on('text', () => { firstMs ??= Date.now() - start; });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') return { text: '', error: 'refusal', firstMs, totalMs: Date.now() - start };
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return { text, firstMs, totalMs: Date.now() - start, stop: message.stop_reason,
      inTokens: message.usage?.input_tokens, outTokens: message.usage?.output_tokens };
  } catch (error) {
    return { text: '', error: `${error?.constructor?.name ?? 'Error'} ${error?.status ?? ''}`.trim(), firstMs, totalMs: Date.now() - start };
  }
}

// ---------------------------------------------------------------- Ollama ---

/** One streamed Ollama call with the same options the bridge forces (num_ctx 4096) unless a lever overrides them. */
export async function callOllama({ model, system, prompt, think = false, temperature = 0, numPredict = 1400, numCtx = 4096, format, extra = {} }) {
  const start = Date.now();
  let firstMs = null;
  try {
    const response = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(300000),
      body: JSON.stringify({ model, system, prompt, stream: true, think, format,
        options: { temperature, num_ctx: numCtx, num_predict: numPredict, ...extra } }),
    });
    if (!response.ok) return { text: '', error: `HTTP ${response.status}`, totalMs: Date.now() - start };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '', text = '', thinking = '', stop = '', evalCount = 0;
    const consume = line => {
      if (!line.trim()) return;
      const data = JSON.parse(line);
      if (data.error) throw new Error(data.error);
      if (data.response) { firstMs ??= Date.now() - start; text += data.response; }
      if (data.thinking) thinking += data.thinking;
      if (data.done) { stop = data.done_reason; evalCount = data.eval_count ?? 0; }
    };
    for (;;) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end;
      while ((end = pending.indexOf('\n')) >= 0) { consume(pending.slice(0, end)); pending = pending.slice(end + 1); }
      if (done) { consume(pending); break; }
    }
    return { text: text.trim(), firstMs, totalMs: Date.now() - start, stop, outTokens: evalCount, thinkingChars: thinking.length };
  } catch (error) {
    return { text: '', error: String(error?.message ?? error).slice(0, 120), firstMs, totalMs: Date.now() - start };
  }
}

// -------------------------------------------------------------- passages ---

/** The paragraph(s) a passage sits in, the way the reader hands them over as context. */
function paragraphsAround(book, find) {
  const at = book.indexOf(find);
  const start = book.lastIndexOf('\n', at) + 1;
  let end = book.indexOf('\n', at + find.length);
  if (end < 0) end = book.length;
  return book.slice(start, end).trim();
}

/** Sentence-ish units of a paragraph; the sentence before `find` is the "previous sentence" lever. */
export function previousSentence(paragraph, find) {
  const at = paragraph.indexOf(find);
  if (at <= 0) return '';
  const before = paragraph.slice(0, at);
  const sentences = before.match(/[^。！？\n]*[。！？][」』”’]?/gu) ?? [];
  return (sentences.at(-1) ?? '').trim();
}

/**
 * Loads the dictionary and the app modules through Vite (so the evaluation runs the real source), then resolves
 * every passage to { id, split, text, context, paragraph, prev, terms, ... }.
 */
export async function loadWorld(vite) {
  const app = {
    prompt: await vite.ssrLoadModule('/src/translate/prompt.ts').catch(() => null),
    local: await vite.ssrLoadModule('/src/translate/localMeaning.ts'),
    sense: await vite.ssrLoadModule('/src/translate/contextSense.ts'),
    popup: await vite.ssrLoadModule('/src/ui/popup/translation.ts'),
    lexicon: await vite.ssrLoadModule('/src/core/lexicon.ts'),
    dict: await vite.ssrLoadModule('/src/core/dict.ts'),
  };
  const dict = await app.dict.loadDictionary('/', { fetchText: async name => {
    const file = /\.(gz|json)$/.test(name) ? name : name.replace(/(\.tsv)?$/, '.tsv.gz');
    const raw = await readFile(join(ROOT, 'public/data', file));
    return (file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
  } });

  // The names the reader would have found for each book (the real detector, over the whole text, cached).
  const lexicons = new Map();
  async function lexiconFor(bookId, text) {
    if (lexicons.has(bookId)) return lexicons.get(bookId);
    const rows = await cached('lexicon', { bookId, detector: app.lexicon.DETECTOR_VERSION, length: text.length }, async () => {
      // Hand the detector chapter-sized pieces, as the importer does.
      const pieces = text.split(/\n(?=第[一二三四五六七八九十百零〇\d]+[回章])/u);
      return app.lexicon.detectTerms(pieces, dict);
    });
    const lexicon = app.lexicon.buildLexicon(rows.filter(row => row.enabled !== false));
    lexicons.set(bookId, lexicon);
    return lexicon;
  }

  const passages = await readJson('passages.json');
  const books = new Map();
  const resolved = [];
  for (const p of passages) {
    if (!books.has(p.book)) books.set(p.book, await readFile(join(ROOT, 'public/samples', `${p.book}.txt`), 'utf8'));
    const book = books.get(p.book);
    const paragraph = paragraphsAround(book, p.find);
    const lexicon = await lexiconFor(p.book, book);
    resolved.push({ ...p, text: p.find, paragraph, context: app.local.contextWindow(paragraph, p.find),
      prev: previousSentence(paragraph, p.find), lexicon, terms: app.popup.translationTerms(p.find, lexicon, dict),
      termsTagged: app.popup.translationTerms(p.find, lexicon, dict, { tagged: true }) });
  }

  // The older hand-made fixtures: their expectation text is the reference, with the same four names in the lexicon.
  const legacyLexicon = app.lexicon.buildLexicon([
    ['郭靖', 'guo1 jing4'], ['黄蓉', 'huang2 rong2'], ['家珍', 'jia1 zhen1'], ['福贵', 'fu2 gui4'],
  ].map(([word, pinyin]) => ({ word, pinyin, gloss: 'name (person)', enabled: true, kind: 'name', origin: 'user' })));
  for (const f of await readJson('legacy.json')) {
    resolved.push({ ...f, book: 'legacy', cat: 'legacy', paragraph: f.context, prev: '', lexicon: legacyLexicon,
      terms: app.popup.translationTerms(f.text, legacyLexicon, dict), termsTagged: app.popup.translationTerms(f.text, legacyLexicon, dict, { tagged: true }) });
  }
  return { app, dict, passages: resolved };
}

export const median = values => {
  const sorted = values.filter(v => typeof v === 'number').sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export const percentile = (values, q) => {
  const sorted = values.filter(v => typeof v === 'number').sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
};
export { sha };
