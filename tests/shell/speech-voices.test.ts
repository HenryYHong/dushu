// @vitest-environment jsdom
// Settings > Speech lists the voices again when the browser loads them late (voiceschanged), instead of saying "No Spanish
// voices found" until the app is reopened; and stops listening when Settings closes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLangForTests } from '../../src/lang/active';
import { createSettingsStore } from '../../src/store/settings';
import type { AppContext } from '../../src/types';
import { speechGroup } from '../../src/ui/settings/speech';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); setLangForTests(null); localStorage.clear(); });

function fakeSpeech() {
  const listeners = new Set<() => void>();
  const s = {
    voices: [] as SpeechSynthesisVoice[],
    getVoices: () => s.voices,
    addEventListener: (_: string, fn: () => void) => { listeners.add(fn); },
    removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn); },
    cancel: vi.fn(),
    listeners,
    load(v: SpeechSynthesisVoice[]) { s.voices = v; for (const fn of [...listeners]) fn(); },
  };
  vi.stubGlobal('speechSynthesis', s);
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  return s;
}
const voice = (name: string, lang: string) => ({ name, lang, voiceURI: name, localService: true, default: false }) as SpeechSynthesisVoice;

describe('the voice list', () => {
  it('fills in once voices arrive after the first listing gave up', async () => {
    vi.useFakeTimers();
    setLangForTests('es');
    const speech = fakeSpeech();
    const g = speechGroup({ settings: createSettingsStore() } as unknown as AppContext);
    const note = g.el.querySelector('.set-voice-note')!;
    expect(note.textContent).toBe('Looking for voices…');
    // The browser had none after 1.5 s.
    await vi.advanceTimersByTimeAsync(1600);
    expect(note.textContent).toMatch(/^No Spanish voices found\. .*then reopen Settings\.$/);
    // Then they load.
    speech.load([voice('Mónica', 'es-ES'), voice('Samantha', 'en-US')]);
    await vi.waitFor(() => expect([...g.el.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Automatic (best Spanish voice)', 'Mónica · es-ES · on-device']));
    expect(note.textContent).toMatch(/^Automatic picks the best voice you have\./);
    g.dispose();
    expect(speech.listeners.size).toBe(0);
  });
});
