// Text to speech with the Web Speech API. Contract: ARCHITECTURE.md §4.8.
import { detectScript } from '../core/text';
import { bridgeFetch, hasMacBridge } from '../core/macBridge';

export interface SpeechOptions {
  rate?: number;
  getRate?: () => number;
  voice?: string;
  lang?: string;
  onStart?: () => void;
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
  return `${name} · ${v.lang}${v.voiceURI.startsWith('dushu-mac:') ? ' · your Mac' : v.localService ? ' · on-device' : ' · online'}`;
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
async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const [browser, native] = await Promise.all([browserVoices(), nativeVoices()]);
  return [...native, ...browser];
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
  const native = pool.find(v => v.localService && v.name.toLowerCase() === preferred);
  if (native) return native;
  return pool.find(v => v.localService) ?? pool[0] ?? zh[0] ?? null;
}

/** Long utterances stall in some Chrome voices. Keep source offsets for spoken-word highlighting. */
function pieces(text: string, max = 180): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  for (const match of text.matchAll(/[^。！？!?；;\n]+[。！？!?；;]*|\n+/g)) {
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
      out.push({ text: part, start: (match.index ?? 0) + leading + offset });
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

async function renderNative(text: string, voice: SpeechSynthesisVoice, signal: AbortSignal, marks: number[] = []): Promise<{ blob: Blob; marks: Marks }> {
  try {
    const response = await bridgeFetch('/api/native-speech', { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(marks.length ? { text, voice: voice.voiceURI, marks } : { text, voice: voice.voiceURI }) });
    if (!response.ok) throw new Error('Could not prepare audio.');
    return { blob: await response.blob(), marks: readMarks(response.headers.get('X-Dushu-Marks'), text.length) };
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('The Premium voice could not prepare audio. Keep your Mac awake and connected, or choose an on-device Chinese voice in Settings.');
  }
}

function primeTouchAudio(): HTMLAudioElement | undefined {
  // iPadOS can use a desktop user agent. Start the same media element inside the tap,
  // before voice discovery/rendering yields; reuse it throughout this reading run.
  if (typeof navigator === 'undefined' || typeof Audio === 'undefined'
    || !(/iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))) return;
  const audio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==');
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
    if (onWord && marks.length) clock = frames ? requestAnimationFrame(tick) : setInterval(follow, 40);
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
    const fail = () => { if (!done) opts?.onError?.('The Premium voice could not play. Tap Read again, or choose an iPad voice in Settings.'); finish(false); };
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
    try { speechSynthesis.speak(u); } catch {
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
  const voice = pickVoice(await loadVoices(), lang, opts?.voice);
  if (mine !== generation) return false;
  if (!voice) {
    opts?.onError?.('No Chinese voice is available. Choose or install a Chinese voice in Settings.');
    return false;
  }
  if (voice.voiceURI.startsWith('dushu-mac:')) {
    const ctl = new AbortController();
    nativeCtl = ctl;
    const queue = parts.flatMap((text, index) => pieces(text).map(piece => ({ ...piece, index })));
    // The Mac takes about 0.7 s plus a little per character to render, so a long first sentence delays the start: read its
    // first clause on its own, and the rest renders while that plays.
    const first = queue[0];
    const cut = first && first.text.length > 24 ? first.text.slice(6, 24).search(/[，、：；,:]/) : -1;
    if (cut >= 0) {
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
      return renderNative(q.text, voice, ctl.signal, words);
    };
    let prepared = queue[0] ? render(queue[0]) : null;
    try {
      for (let i = 0; i < queue.length; i++) {
        const { blob, marks } = await prepared!;
        if (mine !== generation) return false;
        // Render the next sentence during playback, so the listener is not waiting on synthesis.
        prepared = queue[i + 1] ? render(queue[i + 1]) : null;
        prepared?.catch(() => {}); // a stopped run may never await this prefetch
        const q = queue[i];
        if (i === 0 || q.index !== queue[i - 1].index) onPart?.(q.index);
        const rate = Math.min(2, Math.max(0.5, opts?.getRate?.() ?? opts?.rate ?? 1));
        const onWord = onBoundary ? (at: number, len: number) => { if (mine === generation) onBoundary(q.index, q.start + at, len); } : undefined;
        if (!await playNative(blob, rate, opts, touchAudio, marks, q.text.length, onWord)) return false;
      }
      return mine === generation;
    } catch (error) {
      if (mine === generation && !ctl.signal.aborted) opts?.onError?.(error instanceof Error ? error.message : 'Could not prepare Premium audio.');
      return false;
    } finally {
      ctl.abort();
      if (nativeCtl === ctl) nativeCtl = null;
    }
  }
  for (let i = 0; i < parts.length; i++) {
    const chunks = pieces(parts[i]);
    if (!chunks.length) continue;
    if (mine !== generation) return false;
    onPart?.(i);
    for (const piece of chunks) {
      const rate = Math.min(2, Math.max(0.5, opts?.getRate?.() ?? opts?.rate ?? 1));
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
