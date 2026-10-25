import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let speech: typeof import('../../src/speech/tts');
let audio: FakeAudio[];
let sent: { text: string; signal: AbortSignal; marks?: number[] }[];
let marksHeader: string | null;
class FakeAudio {
  playbackRate = 1;
  currentTime = 0;
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
  audio = []; sent = []; marksHeader = null;
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
    const body = JSON.parse(init!.body as string);
    sent.push({ text: body.text, signal: init!.signal as AbortSignal, marks: body.marks });
    return new Response(new Blob(['audio'], { type: 'audio/wav' }), marksHeader ? { headers: { 'X-Dushu-Marks': marksHeader } } : {});
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

  it('sends where each sentence\'s words start, and only when words are highlighted', async () => {
    const wordStarts = vi.fn((i: number) => (i === 0 ? [0, 2, 3, 5, 7] : [0, 1]));
    const run = speech.speakSequence(['你们好。学而时。', '再见。'], { wordStarts }, undefined, () => {});
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    // Offsets are per sentence, and the second sentence of the first part starts at 4.
    expect(sent.map(s => [s.text, s.marks])).toEqual([['你们好。', [0, 2, 3]], ['学而时。', [0, 1, 3]], ['再见。', [0, 1]]]);
    audio[0].onended?.();
    await vi.waitFor(() => expect(audio).toHaveLength(2));
    audio[1].onended?.();
    await vi.waitFor(() => expect(audio).toHaveLength(3));
    audio[2].onended?.();
    expect(await run).toBe(true);
    expect(wordStarts.mock.calls.map(c => c[0])).toEqual([0, 1]);
    sent = [];
    const plain = speech.speakSequence(['你好。'], { wordStarts });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].marks).toBeUndefined();
    speech.stopSpeaking();
    expect(await plain).toBe(false);
  });

  it('reads a long first sentence\'s first clause on its own, so audio starts sooner', async () => {
    const long = '天地之数有十二万九千六百岁，将一元分为十二会，乃子丑寅卯辰巳午未申酉戌亥之十二支也。';
    const words: [number, number, number][] = [];
    const run = speech.speakSequence([long, '再见。'], { wordStarts: () => [0, 14, 20] }, undefined, (part, at, len) => words.push([part, at, len]));
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent.map(s => s.text)).toEqual(['天地之数有十二万九千六百岁，', long.slice(14), '再见。']);
    // Word starts stay in the right place in each half.
    expect(sent.slice(0, 2).map(s => s.marks)).toEqual([[0], [0, 6]]);
    speech.stopSpeaking();
    expect(await run).toBe(false);
    // A short first sentence is left whole.
    sent = [];
    const short = speech.speakSequence(['你好，再见。']);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].text).toBe('你好，再见。');
    speech.stopSpeaking();
    expect(await short).toBe(false);
  });

  it('moves the word highlight with the audio clock', async () => {
    marksHeader = JSON.stringify([[0, 0], [2, 400], [3, 650], [99, 10]]);
    const words: [number, number, number][] = [];
    const run = speech.speakSequence(['。你们好。'], { wordStarts: () => [1, 3, 4] }, undefined, (part, at, len) => words.push([part, at, len]));
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    // The sentence starts after the lone full stop, at 1; its words start at 0, 2 and 3 within it. A mark past its end is dropped.
    expect(sent[0]).toMatchObject({ text: '你们好。', marks: [0, 2, 3] });
    await vi.waitFor(() => expect(words).toEqual([[0, 1, 2]]));
    audio[0].currentTime = 0.45;
    await vi.waitFor(() => expect(words).toEqual([[0, 1, 2], [0, 3, 1]]));
    audio[0].currentTime = 2;
    await vi.waitFor(() => expect(words).toHaveLength(3));
    expect(words[2]).toEqual([0, 4, 1]);
    audio[0].onended?.();
    expect(await run).toBe(true);
  });

  it('surfaces playback errors and resolves rather than leaving the reader stuck', async () => {
    const error = vi.fn();
    const run = speech.speakSequence(['你好。'], { onError: error });
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    audio[0].onerror?.();
    expect(await run).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('could not play'));
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  /** Holds each render until the test lets it go; counts the renders asked for and how many were open at once. */
  function holdRenders() {
    const plain = vi.mocked(fetch).getMockImplementation()!;
    const held: { text: string; go: () => void }[] = [];
    const asked: string[] = [];
    let open = 0;
    let most = 0;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('native-voices')) return plain(url, init);
      const text = JSON.parse(init!.body as string).text as string;
      asked.push(text);
      most = Math.max(most, ++open);
      await new Promise<void>((go) => held.push({ text, go }));
      open--;
      return plain(url, init);
    });
    const release = (text: string) => { const i = held.findIndex((h) => h.text === text); held.splice(i, 1)[0].go(); };
    return { asked, held, release, most: () => most };
  }

  it('keeps closing quotes with their sentence, so the voice never reads a mark by its name', async () => {
    marksHeader = JSON.stringify([[0, 0], [1, 300]]);
    const words: [number, number, number][] = [];
    // 走吧 at 1, 他 at 5 and 说 at 6 in the second paragraph.
    const starts = [[0, 1, 4], [1, 5, 6], [], [0, 1, 4]];
    const run = speech.speakSequence(['他说：“好。”', '“走吧。”他说。', '○○○', '他说："好。"'], { wordStarts: (i) => starts[i] },
      undefined, (part, at, len) => words.push([part, at, len]));
    for (let k = 0; k < 4; k++) {
      await vi.waitFor(() => expect(audio).toHaveLength(k + 1));
      audio[k].onended?.();
    }
    expect(await run).toBe(true);
    expect(sent.map((s) => s.text)).toEqual(['他说：“好。”', '“走吧。”', '他说。', '他说："好。"']);
    // The sentence after a closer starts at its first word, and its words light up where they are.
    expect(sent[2].marks).toEqual([0, 1]);
    expect(words.filter((w) => w[0] === 1)).toEqual([[1, 0, 1], [1, 5, 1]]);
  });

  it('renders the next two sentences while one plays, never more than two at once', async () => {
    const r = holdRenders();
    const run = speech.speakSequence(['一。', '二。', '三。', '四。']);
    await vi.waitFor(() => expect(r.held).toHaveLength(1));
    r.release('一。');
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    await vi.waitFor(() => expect(r.asked).toEqual(['一。', '二。', '三。']));
    r.release('二。');
    audio[0].onended?.();
    await vi.waitFor(() => expect(audio).toHaveLength(2));
    await vi.waitFor(() => expect(r.asked).toHaveLength(4));
    r.release('三。');
    r.release('四。');
    audio[1].onended?.();
    await vi.waitFor(() => expect(audio).toHaveLength(3));
    audio[2].onended?.();
    await vi.waitFor(() => expect(audio).toHaveLength(4));
    audio[3].onended?.();
    expect(await run).toBe(true);
    expect(r.most()).toBe(2);
  });

  it('says it is preparing again when a sentence ends before the next is ready', async () => {
    const r = holdRenders();
    const start = vi.fn();
    const waiting = vi.fn();
    const run = speech.speakSequence(['一。', '二。', '三。'], { onStart: start, onWaiting: waiting });
    await vi.waitFor(() => expect(r.held).toHaveLength(1));
    r.release('一。');
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(r.held).toHaveLength(2));
    r.release('二。');
    await new Promise((done) => setTimeout(done, 50)); // its audio arrives
    audio[0].onended?.(); // the next one was ready
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(waiting).not.toHaveBeenCalled();
    audio[1].onended?.(); // the next one is not
    await vi.waitFor(() => expect(waiting).toHaveBeenCalledOnce());
    r.release('三。');
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(3));
    audio[2].onended?.();
    expect(await run).toBe(true);
    expect(waiting).toHaveBeenCalledOnce();
  });

  it('gives a render time in proportion to its text, so a stalled Mac fails in seconds', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const run = speech.speakSequence(['你好。', '天'.repeat(100) + '。']);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(timeout).toHaveBeenCalledWith(5000 + 60 * 3);
    expect(timeout).toHaveBeenCalledWith(5000 + 60 * 101);
    expect(timeout).not.toHaveBeenCalledWith(35000);
    speech.stopSpeaking();
    expect(await run).toBe(false);
  });

  it('asks again while the Mac is still finishing a render that was just cancelled', async () => {
    const plain = vi.mocked(fetch).getMockImplementation()!;
    let busy = 2;
    vi.mocked(fetch).mockImplementation(async (url, init) => (String(url).endsWith('native-speech') && busy-- > 0 ? new Response('', { status: 429 }) : plain(url, init)));
    const error = vi.fn();
    const run = speech.speakSequence(['你好。'], { onError: error });
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    audio[0].onended?.();
    expect(await run).toBe(true);
    expect(error).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });

  it('changes the speed of the sentence that is playing at once', async () => {
    const run = speech.speakSequence(['你好。'], { rate: 1 });
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    speech.setSpeakingRate(1.5);
    expect(audio[0].playbackRate).toBe(1.5);
    speech.setSpeakingRate(9);
    expect(audio[0].playbackRate).toBe(2);
    audio[0].onended?.();
    expect(await run).toBe(true);
    speech.setSpeakingRate(0.75); // nothing playing
    expect(audio[0].playbackRate).toBe(2);
  });
});
