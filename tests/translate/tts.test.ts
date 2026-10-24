import { afterEach, describe, expect, it, vi } from 'vitest';
import { pauseSpeaking, pickVoice, resumeSpeaking, speakSequence, stopSpeaking, voiceLabel } from '../../src/speech/tts';

const v = (name: string, lang: string, localService = true) => ({ name, lang, voiceURI: name, localService, default: false }) as SpeechSynthesisVoice;
const voices = [v('Alex', 'en-US'), v('Meijia', 'zh-TW'), v('Tingting', 'zh-CN'), v('Google', 'zh_CN', false), v('Sinji', 'zh-HK')];

afterEach(() => { stopSpeaking(); vi.unstubAllGlobals(); });

describe('pickVoice', () => {
  it('prefers a local voice matching the language', () => {
    expect(pickVoice(voices, 'zh-CN')?.name).toBe('Tingting');
    expect(pickVoice(voices, 'zh-TW')?.name).toBe('Meijia');
  });
  it('honors the settings override by name', () => expect(pickVoice(voices, 'zh-CN', 'Sinji')?.name).toBe('Sinji'));
  it('prefers the native Mandarin voices over novelty voices in the same language', () => {
    expect(pickVoice([v('Eddy', 'zh-CN'), ...voices], 'zh-CN')?.name).toBe('Tingting');
    expect(pickVoice([v('Grandma', 'zh-TW'), ...voices], 'zh-TW')?.name).toBe('Meijia');
  });
  it('falls back to any Chinese voice, never an English one', () => {
    expect(pickVoice([v('Alex', 'en-US'), v('Sinji', 'zh-HK')], 'zh-CN')?.name).toBe('Sinji');
    expect(pickVoice([v('Alex', 'en-US')], 'zh-CN')).toBeNull();
  });
  it('prefers premium, then enhanced, over a compact default voice', () => {
    const premium = { ...v('Lili', 'zh-CN'), voiceURI: 'com.apple.voice.premium.zh-CN.Lili' };
    const enhanced = { ...v('Tingting', 'zh-CN'), voiceURI: 'com.apple.voice.enhanced.zh-CN.Tingting' };
    expect(pickVoice([...voices, enhanced, premium], 'zh-CN')).toBe(premium);
    expect(pickVoice([...voices, enhanced], 'zh-CN')).toBe(enhanced);
    expect(voiceLabel(premium)).toBe('Lili (Premium) · zh-CN · on-device');
  });
  it('does not honor an accidentally saved English voice for Chinese reading', () => {
    expect(pickVoice(voices, 'zh-CN', 'Alex')?.name).toBe('Tingting');
  });
  it('recognizes Cantonese language codes instead of switching to Mandarin', () => {
    const cantonese = v('Sinji', 'yue-HK');
    const premium = { ...v('Lili', 'zh-CN'), voiceURI: 'com.apple.voice.premium.zh-CN.Lili' };
    expect(pickVoice([premium, cantonese], 'zh-HK')).toBe(cantonese);
  });
});

describe('chapter speech', () => {
  it('reads paragraphs in order and reports their positions', async () => {
    const spoken: string[] = [];
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      text: string;
      lang = '';
      rate = 1;
      voice: SpeechSynthesisVoice | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    });
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices,
      speak: (u: SpeechSynthesisUtterance) => { spoken.push(u.text); queueMicrotask(() => u.onend?.(new Event('end') as SpeechSynthesisEvent)); },
      cancel: vi.fn(),
    });
    const positions: number[] = [];
    expect(await speakSequence(['第一段。', '第二段。'], {}, i => positions.push(i))).toBe(true);
    expect(spoken).toEqual(['第一段。', '第二段。']);
    expect(positions).toEqual([0, 1]);
  });

  it('stops pending speech without starting the next paragraph', async () => {
    const spoken: string[] = [];
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices,
      speak: (u: SpeechSynthesisUtterance) => { spoken.push(u.text); },
      cancel: vi.fn(),
    });
    const run = speakSequence(['第一段。', '第二段。']);
    await vi.waitFor(() => expect(spoken).toEqual(['第一段。']));
    stopSpeaking();
    expect(await run).toBe(false);
    expect(spoken).toEqual(['第一段。']);
  });

  it('maps spoken boundaries back to the original paragraph after whitespace', async () => {
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      onend: (() => void) | null = null;
      onboundary: ((event: { charIndex: number; charLength: number }) => void) | null = null;
      constructor(public text: string) {}
    });
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices,
      speak: (u: SpeechSynthesisUtterance) => queueMicrotask(() => {
        u.onboundary?.({ charIndex: 1, charLength: 1 } as SpeechSynthesisEvent);
        u.onend?.(new Event('end') as SpeechSynthesisEvent);
      }),
      cancel: vi.fn(),
    });
    const boundaries: [number, number, number][] = [];
    expect(await speakSequence([' 你好。\n  世界。'], {}, undefined, (part, at, len) => boundaries.push([part, at, len]))).toBe(true);
    expect(boundaries).toEqual([[0, 2, 1], [0, 8, 1]]);
  });

  it('ignores the late word events of a Premium voice and keeps to the paragraph', async () => {
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      onend: (() => void) | null = null;
      onboundary: ((event: { charIndex: number; charLength: number }) => void) | null = null;
      constructor(public text: string) {}
    });
    const premium = { ...v('Lili (Premium)', 'zh-CN'), voiceURI: 'Lili (Premium)' };
    const said: (SpeechSynthesisUtterance & { onboundary: unknown })[] = [];
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [...voices, premium],
      speak: (u: SpeechSynthesisUtterance & { onboundary: unknown }) => { said.push(u); queueMicrotask(() => u.onend?.(new Event('end') as SpeechSynthesisEvent)); },
      cancel: vi.fn(),
    });
    const parts: number[] = [];
    const boundary = vi.fn();
    expect(await speakSequence(['你好。'], {}, (i) => parts.push(i), boundary)).toBe(true);
    expect(said[0].voice).toBe(premium);
    expect(said[0].onboundary).toBeNull();
    expect(parts).toEqual([0]);
    // A compact voice keeps its word events.
    expect(await speakSequence(['你好。'], { voice: 'Tingting' }, undefined, boundary)).toBe(true);
    expect(typeof said[1].onboundary).toBe('function');
  });

  it('passes pause and resume to the browser speech engine', () => {
    const pause = vi.fn();
    const resume = vi.fn();
    vi.stubGlobal('SpeechSynthesisUtterance', class {});
    vi.stubGlobal('speechSynthesis', { getVoices: () => voices, cancel: vi.fn(), pause, resume });
    pauseSpeaking();
    resumeSpeaking();
    expect(pause).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
  });

  it('resets a paused engine on stop so a new reading can start', () => {
    const resume = vi.fn();
    vi.stubGlobal('SpeechSynthesisUtterance', class {});
    vi.stubGlobal('speechSynthesis', { paused: true, cancel: vi.fn(), resume });
    stopSpeaking();
    expect(resume).toHaveBeenCalledOnce();
  });

  it('reports an unavailable Chinese voice instead of silently using an English voice', async () => {
    const error = vi.fn();
    const engine = { getVoices: () => [v('Alex', 'en-US')], speak: vi.fn(), cancel: vi.fn() };
    vi.stubGlobal('SpeechSynthesisUtterance', class {});
    vi.stubGlobal('speechSynthesis', engine);
    expect(await speakSequence(['你好。'], { onError: error })).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('No Chinese voice'));
    expect(engine.speak).not.toHaveBeenCalled();
  });

  it('uses a changed reading speed for the next sentence without restarting the paragraph', async () => {
    let rate = 0.9;
    const rates: number[] = [];
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices,
      cancel: vi.fn(),
      speak: (utterance: SpeechSynthesisUtterance) => {
        rates.push(utterance.rate);
        rate = 1.25;
        queueMicrotask(() => utterance.onend?.(new Event('end') as SpeechSynthesisEvent));
      },
    });
    expect(await speakSequence(['你好。再见。'], { getRate: () => rate })).toBe(true);
    expect(rates).toEqual([0.9, 1.25]);
  });

  it('breaks a long utterance at a comma and keeps correct source offsets', async () => {
    const text = '甲'.repeat(130) + '，' + '乙'.repeat(100) + '。';
    const spoken: string[] = [];
    const positions: number[] = [];
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices, cancel: vi.fn(),
      speak: (u: SpeechSynthesisUtterance) => {
        spoken.push(u.text);
        queueMicrotask(() => { u.onboundary?.({ charIndex: 0, charLength: 1 } as SpeechSynthesisEvent); u.onend?.(new Event('end') as SpeechSynthesisEvent); });
      },
    });
    await speakSequence([text], {}, undefined, (_part, at) => positions.push(at));
    expect(spoken.join('')).toBe(text);
    expect(spoken[0]).toBe('甲'.repeat(130) + '，');
    expect(positions).toEqual([0, 131]);
  });

  it('never speaks a closing quote or a separator on its own', async () => {
    const spoken: string[] = [];
    const words: [number, number][] = [];
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices, cancel: vi.fn(),
      speak: (u: SpeechSynthesisUtterance) => {
        spoken.push(u.text);
        queueMicrotask(() => { u.onboundary?.({ charIndex: 0, charLength: 1 } as SpeechSynthesisEvent); u.onend?.(new Event('end') as SpeechSynthesisEvent); });
      },
    });
    const parts: number[] = [];
    expect(await speakSequence(['他说：“好。”', '“走吧。”他说。', '○○○', '他说："好。"', '「来！」』'], {}, (i) => parts.push(i),
      (part, at) => words.push([part, at]))).toBe(true);
    expect(spoken).toEqual(['他说：“好。”', '“走吧。”', '他说。', '他说："好。"', '「来！」』']);
    expect(parts).toEqual([0, 1, 3, 4]);
    // Each sentence's first word is where it is in the paragraph: 他 at 5.
    expect(words.filter((w) => w[0] === 1)).toEqual([[1, 0], [1, 5]]);
  });
});
