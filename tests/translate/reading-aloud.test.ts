// A run of the Mac's voice (or the account's) plays through an audio element, so speechSynthesis.speaking stays false: the
// reading clock asks isReadingAloud, which knows the run is on, and that it is paused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let speech: typeof import('../../src/speech/tts');
let audio: FakeAudio[];
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
  audio = [];
  vi.stubGlobal('location', { hostname: 'localhost' });
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('SpeechSynthesisUtterance', class {});
  vi.stubGlobal('speechSynthesis', { speaking: false, paused: false, getVoices: () => [{ name: 'Tingting', lang: 'zh-CN', localService: true, voiceURI: 'compact' } as SpeechSynthesisVoice], addEventListener: vi.fn(), removeEventListener: vi.fn(), cancel: vi.fn() });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('native-voices')) return new Response(JSON.stringify([{ name: 'Lili (Premium)', lang: 'zh-CN', voiceURI: 'dushu-mac:Lili (Premium)' }]), { headers: { 'Content-Type': 'application/json' } });
    return new Response(new Blob(['audio'], { type: 'audio/wav' }));
  }));
  speech = await import('../../src/speech/tts');
});
afterEach(() => { speech.stopSpeaking(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('a run of the Mac\'s voice', () => {
  it('counts as reading aloud while it plays, not while paused, and not once stopped', async () => {
    expect(speech.isReadingAloud()).toBe(false);
    const run = speech.speakSequence(['你好。', '再见。']);
    await vi.waitFor(() => expect(audio).toHaveLength(1));
    expect(speechSynthesis.speaking).toBe(false);
    expect(speech.isReadingAloud()).toBe(true);
    speech.pauseSpeaking();
    expect(speech.isReadingAloud()).toBe(false);
    speech.resumeSpeaking();
    expect(speech.isReadingAloud()).toBe(true);
    speech.stopSpeaking();
    expect(await run).toBe(false);
    expect(speech.isReadingAloud()).toBe(false);
  });
});
