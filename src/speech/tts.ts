// Text to speech with the Web Speech API. Contract: ARCHITECTURE.md §4.8.
import { detectScript } from '../core/text';
import { bridgeFetch, hasMacBridge } from '../core/macBridge';
import { cloudFetch, cloudSession } from '../core/cloud';

export interface SpeechOptions {
  rate?: number;
  getRate?: () => number;
  voice?: string;
  lang?: string;
  /** Audio started playing (each sentence, with the Mac's voices). */
  onStart?: () => void;
  /** A sentence ended and the Mac has not rendered the next one yet: silence until the next onStart. */
  onWaiting?: () => void;
  onError?: (message: string) => void;
  /** Where the words of part `index` start (UTF-16 offsets into it): the Mac's Premium voices then time each word. */
  wordStarts?: (index: number) => number[];
}

export function canSpeak(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

const norm = (lang: string) => lang.replace('_', '-').toLowerCase();
const isChinese = (v: SpeechSynthesisVoice) => /^(zh|cmn|yue)\b/.test(norm(v.lang));
const voiceLanguage = (v: SpeechSynthesisVoice) => norm(v.lang).replace(/^yue-hk$/, 'zh-hk').replace(/^cmn-(?:hans-)?cn$/, 'zh-cn').replace(/^cmn-(?:hant-)?tw$/, 'zh-tw');
const quality = (v: SpeechSynthesisVoice) => {
  const id = `${v.voiceURI} ${v.name}`.toLowerCase();
  if (/premium/.test(id)) return 0;
  if (/enhanced/.test(id)) return 1;
  return /^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i.test(v.name) ? 3 : 2;
};

export function voiceLabel(v: SpeechSynthesisVoice): string {
  const tier = quality(v);
  const suffix = tier === 0 ? 'Premium' : tier === 1 ? 'Enhanced' : '';
  const name = suffix && !v.name.toLowerCase().includes(suffix.toLowerCase()) ? `${v.name} (${suffix})` : v.name;
  return `${name} · ${v.lang}${v.voiceURI.startsWith('dushu-mac:') ? ' · your Mac' : isAccountVoice(v) ? ' · your account' : v.localService ? ' · on-device' : ' · online'}`;
}

/** Chrome fills getVoices() asynchronously; wait for voiceschanged, but never hang. */
function browserVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!canSpeak()) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise(resolve => {
    const done = () => {
      speechSynthesis.removeEventListener('voiceschanged', done);
      clearTimeout(timer);
      resolve(speechSynthesis.getVoices());
    };
    const timer = setTimeout(done, timeoutMs);
    speechSynthesis.addEventListener('voiceschanged', done);
  });
}

let nativeVoiceCache: Promise<SpeechSynthesisVoice[]> | null = null;
let nativeVoiceCheckedAt = 0;
function nativeVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!hasMacBridge() || typeof Audio === 'undefined') return Promise.resolve([]);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    nativeVoiceCache = null;
    return Promise.resolve([]);
  }
  if (Date.now() - nativeVoiceCheckedAt > 30000) nativeVoiceCache = null;
  if (!nativeVoiceCache) nativeVoiceCheckedAt = Date.now();
  return nativeVoiceCache ??= bridgeFetch('/api/native-voices', { signal: AbortSignal.timeout(2000) }).then(async response => {
    if (!response.ok) { nativeVoiceCache = null; return []; }
    const data = await response.json() as { voiceURI: string; name: string; lang: string }[];
    return Array.isArray(data) ? data.filter(v => typeof v.voiceURI === 'string' && v.voiceURI.startsWith('dushu-mac:') && typeof v.name === 'string' && typeof v.lang === 'string')
      .map(v => ({ ...v, localService: true, default: false }) as SpeechSynthesisVoice) : [];
  }).catch(() => { nativeVoiceCache = null; return []; });
}
/**
 * The account's voice: the sync server reads each sentence (MeloTTS on Workers AI, free within a daily allowance), so a
 * device signed in has a natural Chinese voice without the Mac. It needs the internet; without it this device's voice reads.
 */
export const ACCOUNT_VOICE = 'dushu-cloud:zh';
const isAccountVoice = (v: SpeechSynthesisVoice) => v.voiceURI.startsWith('dushu-cloud:');
/** A voice whose audio is made elsewhere (the Mac, the sync server) and played here, rather than spoken by this browser. */
const isRendered = (v: SpeechSynthesisVoice) => v.voiceURI.startsWith('dushu-mac:') || isAccountVoice(v);
function accountVoices(): SpeechSynthesisVoice[] {
  if (!cloudSession() || typeof Audio === 'undefined') return [];
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];
  return [{ voiceURI: ACCOUNT_VOICE, name: 'Melo', lang: 'zh-CN', localService: false, default: false } as SpeechSynthesisVoice];
}

async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const [browser, native] = await Promise.all([browserVoices(), nativeVoices()]);
  return [...native, ...accountVoices(), ...browser];
}

/** Chinese voices, zh-CN first, then zh-TW, zh-HK, others; on-device voices before network ones. */
export async function listChineseVoices(): Promise<SpeechSynthesisVoice[]> {
  const order = ['zh-cn', 'zh-tw', 'zh-hk'];
  const rank = (v: SpeechSynthesisVoice) => { const i = order.indexOf(voiceLanguage(v)); return i < 0 ? order.length : i; };
  return (await loadVoices()).filter(isChinese).sort((a, b) =>
    rank(a) - rank(b) || Number(b.localService) - Number(a.localService) || quality(a) - quality(b) || a.name.localeCompare(b.name));
}

export function pickVoice(voices: SpeechSynthesisVoice[], lang: string, override?: string): SpeechSynthesisVoice | null {
  const zh = voices.filter(isChinese);
  if (override) {
    const hit = zh.find(v => v.voiceURI === override || v.name === override);
    if (hit) return hit;
  }
  const want = norm(lang);
  const same = zh.filter(v => voiceLanguage(v) === want);
  const pool = same.length ? same : zh.filter(v => v.lang && norm(v.lang).startsWith('zh'));
  const preferred = want === 'zh-tw' ? 'meijia' : want === 'zh-hk' ? 'sinji' : 'tingting';
  const upgraded = pool.filter(v => v.localService && quality(v) < 2).sort((a, b) => quality(a) - quality(b));
  if (upgraded.length) return upgraded[0];
  // The account's voice reads better than a compact on-device voice, though not than a Premium or Enhanced one.
  const account = pool.find(isAccountVoice);
  if (account) return account;
  const native = pool.find(v => v.localService && v.name.toLowerCase() === preferred);
  if (native) return native;
  return pool.find(v => v.localService) ?? pool[0] ?? zh[0] ?? null;
}

/** Nothing a voice should say: alone, a closing quote or bracket is read out by its name. */
const unspoken = (text: string) => /^[\s\p{P}\p{S}]*$/u.test(text);

/**
 * Long utterances stall in some Chrome voices. Keep source offsets for spoken-word highlighting. A sentence keeps the closers
 * after its mark; a piece with nothing to say (a lone ” or ……) joins the one before it, or is dropped at a paragraph's start
 * (a ○○○ separator).
 */
function pieces(text: string, max = 180): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  // Only marks that can only close: after a sentence mark, ASCII " and ' may open the next quote.
  for (const match of text.matchAll(/[^。！？!?；;\n]+[。！？!?；;]*[」』”’）】〉》]*|\n+/g)) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const clean = raw.trim();
    if (!clean) continue;
    const chars = [...clean];
    let offset = 0;
    for (let i = 0; i < chars.length;) {
      // Prefer a breathing point to cutting a long sentence mid-word.
      let end = Math.min(i + max, chars.length);
      if (end < chars.length) {
        for (let j = end - 1; j >= i + Math.floor(max / 2); j--) {
          if (/[，、,：:]/.test(chars[j])) { end = j + 1; break; }
        }
      }
      const part = chars.slice(i, end).join('');
      const start = (match.index ?? 0) + leading + offset;
      const prev = out[out.length - 1];
      if (!unspoken(part)) out.push({ text: part, start });
      else if (prev) prev.text = text.slice(prev.start, start + part.length); // the source between, so offsets still hold
      offset += part.length;
      i = end;
    }
  }
  return out;
}

let generation = 0;
let finishPending: (() => void) | null = null;
let nativeCtl: AbortController | null = null;
let nativeAudio: HTMLAudioElement | null = null;
let nativePaused = false;

export function stopSpeaking(): void {
  generation++;
  finishPending?.();
  nativeCtl?.abort();
  nativeCtl = null;
  nativeAudio?.pause();
  nativeAudio = null;
  nativePaused = false;
  if (canSpeak()) {
    speechSynthesis.cancel();
    // Cancel leaves Chromium's engine paused; reset it so starting again can speak.
    if (speechSynthesis.paused) speechSynthesis.resume();
  }
}

export function pauseSpeaking(): void {
  nativePaused = true;
  if (nativeCtl) { nativeAudio?.pause(); return; }
  if (canSpeak()) speechSynthesis.pause();
}

export function resumeSpeaking(): void {
  nativePaused = false;
  if (nativeCtl) { void nativeAudio?.play().catch(() => finishPending?.()); return; }
  if (canSpeak()) speechSynthesis.resume();
}

const clampRate = (rate: number) => Math.min(2, Math.max(0.5, rate));

/**
 * A new speed for the Mac's audio, at once: the word marks follow its clock, so they keep step. A Web Speech utterance
 * cannot change speed; its next sentence reads `getRate`.
 */
export function setSpeakingRate(rate: number): void {
  if (nativeAudio && Number.isFinite(rate)) nativeAudio.playbackRate = clampRate(rate);
}

/** When each marked word starts in a rendered sentence: [offset, ms] pairs, in order. */
type Marks = [number, number][];

function readMarks(header: string | null, length: number): Marks {
  try {
    const marks = JSON.parse(header || '[]') as unknown;
    if (!Array.isArray(marks)) return [];
    return marks.filter((m): m is [number, number] => Array.isArray(m) && Number.isInteger(m[0]) && m[0] >= 0 && m[0] < length
      && Number.isFinite(m[1])).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  } catch { return []; }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

/** How long the Mac may take over a sentence: a render takes about 0.7 s plus 17 ms a character, so a stalled Mac fails in seconds. */
export const renderTimeout = (text: string) => 5000 + 60 * text.length;

async function renderNative(text: string, voice: SpeechSynthesisVoice, signal: AbortSignal, marks: number[] = []): Promise<{ blob: Blob; marks: Marks }> {
  try {
    const limit = AbortSignal.any([signal, AbortSignal.timeout(renderTimeout(text))]);
    for (let wait = 100; ; wait *= 2) {
      const response = await bridgeFetch('/api/native-speech', { method: 'POST', signal: limit,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(marks.length ? { text, voice: voice.voiceURI, marks } : { text, voice: voice.voiceURI }) });
      // The Mac renders two at a time, and a render just cancelled (Pronounce, Read from here) keeps its place until its
      // process exits: ask again in a moment.
      if (response.status === 429 && wait <= 800) { await delay(wait, limit); continue; }
      if (!response.ok) throw new Error('Could not prepare audio.');
      return { blob: await response.blob(), marks: readMarks(response.headers.get('X-Dushu-Marks'), text.length) };
    }
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('The Premium voice could not prepare audio. Keep your Mac awake and connected, or choose an on-device Chinese voice in Settings.');
  }
}

/** The sync server reads a sentence. Its answer is the model's own, { audio: base64 WAV }: decoded here, not on the server. */
async function renderAccount(text: string, signal: AbortSignal): Promise<{ blob: Blob; marks: Marks }> {
  let response: Response | null;
  try {
    response = await cloudFetch('/speech', { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(renderTimeout(text) + 10_000)]),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Could not reach the sync server to read aloud.');
  }
  if (!response) throw new Error('This device is signed out, so the account voice cannot read.');
  const data = await response.json().catch(() => null) as { audio?: unknown; error?: unknown } | null;
  if (!response.ok || typeof data?.audio !== 'string') throw new Error(typeof data?.error === 'string' ? data.error : 'The account voice could not prepare audio.');
  const bin = atob(data.audio);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: 'audio/wav' }), marks: [] };
}

/**
 * When each word starts in audio that has no word marks (the account's voice): each Chinese character is one syllable, a
 * comma or a full stop a pause, spread over the audio less a little quiet at each end. `words` are offsets into `text`.
 */
export function estimateMarks(text: string, words: number[], ms: number): Marks {
  const weight = (ch: string) => /\p{Script=Han}/u.test(ch) ? 1 : /[，、；：,;:]/.test(ch) ? 0.8 : /[。！？!?…]/.test(ch) ? 1.2
    : /[\p{L}\p{N}]/u.test(ch) ? 0.35 : 0;
  // Weighed by character (a rare Han character is two UTF-16 units), indexed by UTF-16 offset as `words` are.
  const before: number[] = [0];
  for (const ch of text) {
    const at = before.length - 1;
    before.push(before[at] + weight(ch));
    if (ch.length === 2) before.push(before[at + 1]);
  }
  const total = before[text.length] || 1;
  const quiet = Math.min(200, ms * 0.05);
  // The first word is lit as the audio starts.
  return words.filter(o => o >= 0 && o < text.length).map((o, i) => [o, i === 0 ? 0 : quiet + (ms - 2 * quiet) * before[o] / total] as [number, number]);
}

const SILENCE = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

function primeTouchAudio(): HTMLAudioElement | undefined {
  // iPadOS can use a desktop user agent. Start the same media element inside the tap,
  // before voice discovery/rendering yields; reuse it throughout this reading run.
  if (typeof navigator === 'undefined' || typeof Audio === 'undefined'
    || !(/iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))) return;
  // A tenth of a second of silence (8 kHz, 8-bit): WebKit would not decode the one-sample clip this used to be.
  const audio = new Audio(SILENCE);
  void audio.play().catch(() => {});
  return audio;
}

/**
 * Plays one rendered sentence. With word marks, reports each word as the audio reaches it: (offset, length up to the next
 * word). The audio clock already counts the playback rate.
 */
function playNative(
  blob: Blob, rate: number, opts?: SpeechOptions, reusable?: HTMLAudioElement,
  marks: Marks = [], length = 0, onWord?: (offset: number, length: number) => void,
  estimate?: { text: string; words: number[] },
): Promise<boolean> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const audio = reusable ?? new Audio();
    audio.src = url;
    nativeAudio = audio;
    audio.playbackRate = rate;
    audio.preservesPitch = true;
    let done = false;
    let shown = -1;
    const follow = () => {
      if (done || !onWord) return;
      // Audio without marks: estimated once its length is known.
      if (!marks.length && estimate?.words.length && Number.isFinite(audio.duration) && audio.duration > 0) {
        marks = estimateMarks(estimate.text, estimate.words, audio.duration * 1000);
      }
      const ms = audio.currentTime * 1000;
      let k = shown;
      while (k + 1 < marks.length && marks[k + 1][1] <= ms) k++;
      if (k === shown) return;
      shown = k;
      const end = marks.find(m => m[0] > marks[k][0])?.[0] ?? length;
      onWord(marks[k][0], end - marks[k][0]);
    };
    // Every frame where there are frames (a 40 ms timer elsewhere): at 2× a coarser clock let the highlight trail by a word.
    let clock: ReturnType<typeof setInterval> | number | undefined;
    const frames = typeof requestAnimationFrame === 'function';
    const tick = () => { follow(); if (!done) clock = requestAnimationFrame(tick); };
    if (onWord && (marks.length || estimate?.words.length)) clock = frames ? requestAnimationFrame(tick) : setInterval(follow, 40);
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (frames) cancelAnimationFrame(clock as number); else clearInterval(clock);
      audio.pause();
      audio.onplaying = audio.onended = audio.onerror = null;
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      if (nativeAudio === audio) nativeAudio = null;
      if (finishPending === cancel) finishPending = null;
      resolve(ok);
    };
    const cancel = () => finish(false);
    finishPending = cancel;
    audio.onplaying = () => { if (!done) { opts?.onStart?.(); follow(); } };
    audio.onended = () => finish(true);
    const fail = () => { if (!done) opts?.onError?.('The voice could not play. Tap Read again, or choose an iPad voice in Settings.'); finish(false); };
    audio.onerror = fail;
    if (!nativePaused) void audio.play().catch(fail);
    follow(); // the sentence's first word, as its audio starts
  });
}

function speakPiece(
  text: string, lang: string, voice: SpeechSynthesisVoice | null, rate: number,
  onBoundary?: (charIndex: number, charLength: number) => void,
  opts?: SpeechOptions,
): Promise<boolean> {
  // A Premium (neural) voice reports words late, two phrases behind and then not at all: highlighting by those events would
  // lag and stall, so it keeps to the paragraph.
  if (voice && quality(voice) === 0) onBoundary = undefined;
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang || lang;
    if (voice) u.voice = voice;
    u.rate = rate;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (finishPending === cancel) finishPending = null;
      resolve(ok);
    };
    const cancel = () => finish(false);
    finishPending = cancel;
    u.onend = () => finish(true);
    u.onstart = () => { if (!done) opts?.onStart?.(); };
    u.onerror = e => {
      if (!done && e.error !== 'canceled' && e.error !== 'interrupted') opts?.onError?.('The speech voice could not play. Try another Chinese voice in Settings.');
      finish(false);
    };
    if (onBoundary) u.onboundary = (e) => onBoundary(e.charIndex, e.charLength || 1);
    try {
      // Paused before this voice took over (the account's voice failed while paused): it is queued paused and waits for Resume.
      if (nativePaused) speechSynthesis.pause();
      speechSynthesis.speak(u);
    } catch {
      opts?.onError?.('This browser could not start audio. Try another Chinese voice in Settings.');
      finish(false);
    }
  });
}

/** Speak paragraphs in order. Returns false if stopped, interrupted, or unavailable. */
export async function speakSequence(
  parts: string[], opts?: SpeechOptions,
  onPart?: (index: number) => void,
  onBoundary?: (partIndex: number, charIndex: number, charLength: number) => void,
): Promise<boolean> {
  if (!canSpeak() || !parts.some(p => p.trim())) return false;
  stopSpeaking();
  const touchAudio = primeTouchAudio();
  const mine = generation;
  const lang = opts?.lang ?? (detectScript(parts.join('')) === 'traditional' ? 'zh-TW' : 'zh-CN');
  let voice = pickVoice(await loadVoices(), lang, opts?.voice);
  if (mine !== generation) return false;
  if (!voice) {
    opts?.onError?.('No Chinese voice is available. Choose or install a Chinese voice in Settings.');
    return false;
  }
  // The paragraph this browser's own voice reads from: 0, or where the account's voice stopped.
  let from = 0;
  if (isRendered(voice)) {
    const rendered = voice;
    const ctl = new AbortController();
    nativeCtl = ctl;
    const queue = parts.flatMap((text, index) => pieces(text).map(piece => ({ ...piece, index })));
    // The Mac takes about 0.7 s plus a little per character to render, so a long first sentence delays the start: read its
    // first clause on its own, and the rest renders while that plays.
    const first = queue[0];
    const cut = first && first.text.length > 24 ? first.text.slice(6, 24).search(/[，、：；,:]/) : -1;
    if (cut >= 0 && !unspoken(first.text.slice(cut + 7))) {
      const at = cut + 7;
      queue.splice(0, 1, { ...first, text: first.text.slice(0, at) }, { ...first, text: first.text.slice(at), start: first.start + at });
    }
    // Word starts are asked for as each sentence is rendered, not for the whole chapter up front.
    const starts = new Map<number, number[]>();
    const render = (q: (typeof queue)[number]) => {
      let words: number[] = [];
      if (opts?.wordStarts && onBoundary) {
        if (!starts.has(q.index)) starts.set(q.index, opts.wordStarts(q.index));
        words = [0, ...starts.get(q.index)!.filter(o => o > q.start && o < q.start + q.text.length).map(o => o - q.start)];
      }
      return (isAccountVoice(rendered) ? renderAccount(q.text, ctl.signal) : renderNative(q.text, rendered, ctl.signal, words)).then(r => ({ ...r, words }));
    };
    // The next two sentences render while one plays, the Mac's limit: with one, a long sentence after a short one was not
    // ready in time at 2×.
    const renders: (ReturnType<typeof render> | undefined)[] = [];
    const ready = new Set<number>();
    const ahead = (k: number) => {
      if (k >= queue.length || renders[k]) return;
      const p = renders[k] = render(queue[k]);
      p.then(() => ready.add(k), () => {}); // a stopped run may never await this prefetch
    };
    ahead(0);
    let at = 0;
    try {
      for (let i = 0; i < queue.length; i++) {
        at = queue[i].index;
        // The sentence before has ended and this one is not ready: the reader says it is preparing, not reading, over the silence.
        if (i > 0 && !ready.has(i)) opts?.onWaiting?.();
        const { blob, marks, words } = await renders[i]!;
        renders[i] = undefined;
        if (mine !== generation) return false;
        ahead(i + 1);
        ahead(i + 2);
        const q = queue[i];
        if (i === 0 || q.index !== queue[i - 1].index) onPart?.(q.index);
        const rate = clampRate(opts?.getRate?.() ?? opts?.rate ?? 1);
        const onWord = onBoundary ? (at: number, len: number) => { if (mine === generation) onBoundary(q.index, q.start + at, len); } : undefined;
        if (!await playNative(blob, rate, opts, touchAudio, marks, q.text.length, onWord, isAccountVoice(rendered) ? { text: q.text, words } : undefined)) return false;
      }
      return mine === generation;
    } catch (error) {
      if (mine !== generation || ctl.signal.aborted) return false;
      // The account's voice could not read (no internet on a train, today's allowance used up): this device's own voice reads
      // on from the paragraph it stopped in.
      const own = isAccountVoice(rendered) ? pickVoice(await browserVoices(), lang) : null;
      if (mine !== generation) return false;
      if (!own) {
        opts?.onError?.(error instanceof Error ? error.message : 'Could not prepare Premium audio.');
        return false;
      }
      console.warn('Dushu: the account voice could not read, so this device’s voice reads instead', error);
      voice = own;
      from = at;
    } finally {
      ctl.abort();
      if (nativeCtl === ctl) nativeCtl = null;
    }
  }
  for (let i = from; i < parts.length; i++) {
    const chunks = pieces(parts[i]);
    if (!chunks.length) continue;
    if (mine !== generation) return false;
    onPart?.(i);
    for (const piece of chunks) {
      const rate = clampRate(opts?.getRate?.() ?? opts?.rate ?? 1);
      if (mine !== generation || !await speakPiece(piece.text, lang, voice, rate,
        onBoundary ? (at, len) => { if (mine === generation) onBoundary(i, piece.start + at, len); } : undefined, opts)) return false;
    }
  }
  return mine === generation;
}

/** Cancels anything playing, then resolves when this text has been spoken (or was stopped). */
export async function speak(text: string, opts?: SpeechOptions): Promise<boolean> {
  return speakSequence([text], opts);
}
