// Read-aloud through the sync account: a device signed in gets the account's voice (the sync server reads each sentence with
// Workers AI and the device decodes the WAV), words are highlighted by an estimate of when each starts, and when the account
// cannot read (no internet, today's allowance used up) this device's own voice carries on. The server is faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let speech: typeof import('../../src/speech/tts');
let audio: FakeAudio[];
let asked: { url: string; auth: string | null; text: string }[];
let spoken: string[];
let blobs: Blob[];
let answer: () => Promise<Response>;
const WAV = 'RIFF....WAVEfmt fake audio';

class FakeAudio {
  playbackRate = 1;
  currentTime = 0;
  duration = Number.NaN;
  preservesPitch = false;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  play = vi.fn(async () => { this.onplaying?.(); });
  removeAttribute = vi.fn();
  constructor(public src = '') { audio.push(this); }
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear(), key: () => null, get length() { return m.size; } };
}
const signIn = () => localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 'a'.repeat(64) + '.' + 'b'.repeat(43), email: 'reader@example.com' }));
const tingting = { name: 'Tingting', lang: 'zh-CN', localService: true, voiceURI: 'com.apple.voice.compact.zh-CN.Tingting', default: false } as SpeechSynthesisVoice;

beforeEach(async () => {
  vi.resetModules();
  audio = []; asked = []; spoken = []; blobs = [];
  answer = async () => new Response(JSON.stringify({ audio: btoa(WAV) }), { headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('location', { hostname: 'henryyhong.com', protocol: 'https:', origin: 'https://henryyhong.com' });
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    lang = ''; rate = 1; voice: SpeechSynthesisVoice | null = null;
    onend: (() => void) | null = null; onerror: (() => void) | null = null; onstart: (() => void) | null = null;
    constructor(public text: string) {}
  });
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => [tingting], addEventListener: vi.fn(), removeEventListener: vi.fn(), cancel: vi.fn(), paused: false,
    speak: (u: SpeechSynthesisUtterance) => { spoken.push(u.text); queueMicrotask(() => u.onend?.(new Event('end') as SpeechSynthesisEvent)); },
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { blobs.push(b as Blob); return 'blob:test'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    asked.push({ url, auth: new Headers(init?.headers).get('Authorization'), text: JSON.parse(String(init?.body ?? '{}')).text });
    return answer();
  }));
  speech = await import('../../src/speech/tts');
});
afterEach(() => { speech.stopSpeaking(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the account’s voice', () => {
  it('is offered only to a device signed in, after Premium and Enhanced voices but before a compact one', async () => {
    expect((await speech.listChineseVoices()).map((v) => v.voiceURI)).toEqual([tingting.voiceURI]);
    signIn();
    const voices = await speech.listChineseVoices();
    const account = voices.find((v) => v.voiceURI === speech.ACCOUNT_VOICE)!;
    expect(speech.voiceLabel(account)).toBe('Melo · zh-CN · your account');
    expect(speech.pickVoice(voices, 'zh-CN')).toBe(account);
    const enhanced = { ...tingting, name: 'Tingting (Enhanced)', voiceURI: 'com.apple.voice.enhanced.zh-CN.Tingting' } as SpeechSynthesisVoice;
    expect(speech.pickVoice([...voices, enhanced], 'zh-CN')).toBe(enhanced);
    expect(speech.pickVoice(voices, 'zh-CN', tingting.voiceURI)).toBe(tingting);
  });

  it('reads each sentence through the sync server and plays the WAV it sends', async () => {
    signIn();
    const run = speech.speakSequence(['你好。再见。']);
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    expect(asked[0]).toMatchObject({ url: 'https://dushu-sync.henryhong.workers.dev/speech', auth: `Bearer ${'a'.repeat(64)}.${'b'.repeat(43)}`, text: '你好。' });
    expect(blobs[0].type).toBe('audio/wav');
    expect(await blobs[0].text()).toBe(WAV);
    audio[0].onended?.();
    await vi.waitFor(() => expect(audio).toHaveLength(2));
    expect(asked.map((a) => a.text)).toEqual(['你好。', '再见。']);
    audio[1].onended?.();
    expect(await run).toBe(true);
    expect(spoken).toEqual([]);
  });

  it('highlights each word as the audio reaches it, by an estimate from its length', async () => {
    signIn();
    const words: [number, number][] = [];
    const run = speech.speakSequence(['你们好吗？'], { wordStarts: () => [2, 3] }, undefined, (_p, at, len) => words.push([at, len]));
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    audio[0].duration = 2.4; // 你们 好 吗 ？: four beats and a long pause, 0.12 s quiet at each end
    await vi.waitFor(() => expect(words).toEqual([[0, 2]]));
    audio[0].currentTime = 1.0;
    await vi.waitFor(() => expect(words).toEqual([[0, 2], [2, 1]]));
    audio[0].currentTime = 1.5;
    await vi.waitFor(() => expect(words).toEqual([[0, 2], [2, 1], [3, 2]]));
    audio[0].onended?.();
    expect(await run).toBe(true);
  });

  it('hands over to this device’s voice when the server cannot be reached', async () => {
    signIn();
    answer = async () => { throw new TypeError('Load failed'); };
    const error = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await speech.speakSequence(['第一段。', '第二段。'], { onError: error })).toBe(true);
    expect(spoken).toEqual(['第一段。', '第二段。']);
    expect(error).not.toHaveBeenCalled();
  });

  it('hands over in the paragraph it stopped in once today’s allowance is used up', async () => {
    signIn();
    let n = 0;
    const ok = answer;
    answer = async () => (++n === 1 ? ok() : new Response(JSON.stringify({ error: 'Today’s read-aloud on your account is used up.', code: 'daily_limit' }), { status: 429 }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parts: number[] = [];
    const run = speech.speakSequence(['第一段。', '第二段。', '第三段。'], {}, (i) => parts.push(i));
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    audio[0].onended?.();
    expect(await run).toBe(true);
    expect(spoken).toEqual(['第二段。', '第三段。']);
    expect(parts).toEqual([0, 1, 2]);
  });

  it('is not offered when the device is offline', async () => {
    signIn();
    vi.stubGlobal('navigator', { onLine: false, userAgent: 'test' });
    expect((await speech.listChineseVoices()).some((v) => v.voiceURI === speech.ACCOUNT_VOICE)).toBe(false);
  });
});

describe('pausing while the account’s voice prepares a sentence', () => {
  it('keeps this device’s voice paused when it takes over because the account’s voice failed', async () => {
    signIn();
    let release!: () => void;
    let n = 0;
    const ok = answer;
    answer = async () => {
      if (++n === 1) return ok();
      await new Promise<void>((r) => { release = r; });
      return new Response(JSON.stringify({ error: 'Today’s free read-aloud is used up.', code: 'daily_limit' }), { status: 429 });
    };
    let paused = false;
    const heard: string[] = [];
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [tingting], addEventListener: vi.fn(), removeEventListener: vi.fn(), cancel: vi.fn(),
      get paused() { return paused; },
      pause: vi.fn(() => { paused = true; }), resume: vi.fn(() => { paused = false; }),
      // A paused engine queues the sentence silently; one that is not paused starts talking.
      speak: (u: SpeechSynthesisUtterance) => { if (!paused) heard.push(u.text); },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    void speech.speakSequence(['第一段。', '第二段。'], { onWaiting: () => {} });
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    audio[0].onended?.();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    speech.pauseSpeaking();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(heard).toEqual([]);
  });
});

describe('estimateMarks', () => {
  it('gives a rare character (two UTF-16 units) the beat of any other', () => {
    const rare = speech.estimateMarks('\u{20000}我', [0, 2], 1000);
    const common = speech.estimateMarks('你我', [0, 1], 1000);
    expect(rare[1][1]).toBeCloseTo(common[1][1], 0);
  });

  it('spreads the words over the audio by syllables and pauses, in order and inside it', () => {
    const marks = speech.estimateMarks('我们说好了，明天见。', [0, 2, 3, 4, 6, 8], 3000);
    expect(marks.map((m) => m[0])).toEqual([0, 2, 3, 4, 6, 8]);
    const ms = marks.map((m) => m[1]);
    expect(ms[0]).toBe(0);
    expect(ms[1]).toBeGreaterThan(150); // past the quiet at the start
    for (let i = 1; i < ms.length; i++) expect(ms[i]).toBeGreaterThan(ms[i - 1]);
    expect(ms[ms.length - 1]).toBeLessThan(3000);
    // The comma is a pause: 明天 starts later than five even beats would put it.
    expect(ms[4] - ms[3]).toBeGreaterThan(ms[3] - ms[2]);
    expect(speech.estimateMarks('你好', [5], 1000)).toEqual([]);
  });
});
