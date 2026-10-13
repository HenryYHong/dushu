import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let speech: typeof import('../../src/speech/tts');
let audio: FakeAudio[];
let sent: { text: string; signal: AbortSignal }[];
class FakeAudio {
  playbackRate = 1;
  preservesPitch = false;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  play = vi.fn(async () => { this.onplaying?.(); });
  removeAttribute = vi.fn();
  constructor(public src: string) { audio.push(this); }
}

beforeEach(async () => {
  vi.resetModules();
  audio = []; sent = [];
  vi.stubGlobal('location', { hostname: 'localhost' });
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('SpeechSynthesisUtterance', class {});
  vi.stubGlobal('speechSynthesis', { getVoices: () => [], addEventListener: vi.fn(), removeEventListener: vi.fn(), cancel: vi.fn() });
  // A browser voice avoids the asynchronous empty-list wait; Premium must still win.
  speechSynthesis.getVoices = () => [{ name: 'Tingting', lang: 'zh-CN', localService: true, voiceURI: 'compact' } as SpeechSynthesisVoice];
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('native-voices')) return new Response(JSON.stringify([{ name: 'Lili (Premium)', lang: 'zh-CN', voiceURI: 'dushu-mac:Lili (Premium)' }]), { headers: { 'Content-Type': 'application/json' } });
    sent.push({ text: JSON.parse(init!.body as string).text, signal: init!.signal as AbortSignal });
    return new Response(new Blob(['audio'], { type: 'audio/wav' }));
  }));
  speech = await import('../../src/speech/tts');
});
afterEach(() => { speech.stopSpeaking(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('native Premium audio', () => {
  it('explains how to recover if the Mac disconnects during synthesis', async () => {
    await speech.listChineseVoices();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const error = vi.fn();
    expect(await speech.speakSequence(['你好。'], { onError: error })).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Keep your Mac awake and connected'));
  });
  it('drops cached Mac voices offline and uses the available device voice without a render request', async () => {
    await speech.listChineseVoices();
    vi.stubGlobal('navigator', { onLine: false, userAgent: 'iPad', maxTouchPoints: 5 });
    expect((await speech.listChineseVoices()).some(v => v.voiceURI.startsWith('dushu-mac:'))).toBe(false);
    const speak = vi.fn();
    Object.assign(speechSynthesis, { speak });
    const run = speech.speakSequence(['你好。']);
    await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce());
    expect(speak.mock.calls[0][0].voice.voiceURI).toBe('compact');
    speak.mock.calls[0][0].onend();
    expect(await run).toBe(true);
    expect(sent).toHaveLength(0);
  });
  it('retries discovery after a temporary voice-service error instead of caching unavailable forever', async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(new Response('', { status: 503 }));
    expect((await speech.listChineseVoices()).some(v => v.voiceURI.startsWith('dushu-mac:'))).toBe(false);
    expect((await speech.listChineseVoices()).some(v => v.voiceURI.startsWith('dushu-mac:'))).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('primes audio synchronously on iPad and reuses that element after asynchronous rendering', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari', maxTouchPoints: 5 });
    vi.stubGlobal('location', { hostname: 'my-mac.private.ts.net', protocol: 'https:' });
    const run = speech.speakSequence(['你好。', '再见。']);
    expect(audio).toHaveLength(1);
    expect(audio[0].play).toHaveBeenCalledOnce();
    expect(audio[0].src).toMatch(/^data:audio/);
    await vi.waitFor(() => expect(audio[0].src).toBe('blob:test'));
    audio[0].onended?.();
    await vi.waitFor(() => expect(audio[0].play).toHaveBeenCalledTimes(3));
    expect(audio).toHaveLength(1);
    audio[0].onended?.();
    expect(await run).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it('prefetches the next sentence, preserves pitch and releases audio after finishing', async () => {
    const start = vi.fn(); const positions: number[] = [];
    let rate = 0.9;
    const run = speech.speakSequence(['你好。', '再见。'], { onStart: start, getRate: () => rate }, i => positions.push(i));
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    expect(sent.map(s => s.text)).toEqual(['你好。', '再见。']);
    expect(audio[0].preservesPitch).toBe(true);
    expect(audio[0].playbackRate).toBe(0.9);
    rate = 1.25;
    audio[0].onended?.();
    await vi.waitFor(() => expect(audio).toHaveLength(2));
    expect(audio[1].playbackRate).toBe(1.25);
    audio[1].onended?.();
    expect(await run).toBe(true);
    expect(positions).toEqual([0, 1]);
    expect(start).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('pauses, resumes and cancels prefetched audio without advancing', async () => {
    const run = speech.speakSequence(['你好。', '再见。']);
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    speech.pauseSpeaking();
    expect(audio[0].pause).toHaveBeenCalledOnce();
    speech.resumeSpeaking();
    expect(audio[0].play).toHaveBeenCalledTimes(2);
    speech.stopSpeaking();
    expect(await run).toBe(false);
    expect(sent.every(s => s.signal.aborted)).toBe(true);
    expect(audio).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('surfaces playback errors and resolves rather than leaving the reader stuck', async () => {
    const error = vi.fn();
    const run = speech.speakSequence(['你好。'], { onError: error });
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    audio[0].onerror?.();
    expect(await run).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Premium voice'));
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
});
