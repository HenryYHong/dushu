// The Speech group: voice list, rate, and a test button.
import type { AppContext, Settings } from '../../types';
import { h } from '../dom';
import { icon } from '../icons';
import { canSpeak, listChineseVoices, speak, stopSpeaking, voiceLabel } from '../../speech/tts';
import { group, nextId, row, slider } from './controls';

export const TEST_SENTENCE = '你好，欢迎使用读书。今天我们一起读一本书。';

/** The read-aloud speed as the reader's menu and audio strip show it: 0.9×, 1×, 1.25×. */
export const rateLabel = (n: number): string => `${Number(n.toFixed(2))}×`;

export function speechGroup(ctx: AppContext): { el: HTMLElement; update(s: Settings): void; dispose(): void } {
  const { settings } = ctx;
  const voiceId = nextId('voice');
  const select = h('select.select', { id: voiceId, 'aria-label': 'Voice' }) as HTMLSelectElement;
  const note = h('div.set-help.set-voice-note');
  let voices: SpeechSynthesisVoice[] = [];
  let listed = false;

  const fill = (current: string) => {
    const opts = [h('option', { value: '' }, 'Automatic (best Chinese voice)')];
    for (const v of voices) opts.push(h('option', { value: v.voiceURI }, voiceLabel(v)));
    // A saved voice that is not installed here (another machine) stays visible instead of silently resetting.
    if (current && !voices.some((v) => v.voiceURI === current || v.name === current)) opts.push(h('option', { value: current }, `${current} (not installed)`));
    select.replaceChildren(...opts);
    select.value = current;
  };
  select.addEventListener('change', () => settings.set({ ttsVoice: select.value }));

  const rate = slider('ttsRate', 'Read-aloud speed', { min: 0.5, max: 2, step: 0.05, format: rateLabel }, (v) => settings.set({ ttsRate: v }));

  const test = h('button.btn.btn-sm', { type: 'button' }, icon('speaker'), 'Test voice') as HTMLButtonElement;
  const testStatus = h('div.set-help', { role: 'status', 'aria-live': 'polite' });
  let playing = false;
  let testRun = 0;
  test.addEventListener('click', () => {
    if (playing) {
      testRun++;
      stopSpeaking();
      playing = false;
      test.replaceChildren(icon('speaker'), 'Test voice');
      testStatus.textContent = 'Voice sample stopped.';
      return;
    }
    const s = settings.get();
    const mine = ++testRun;
    playing = true;
    test.replaceChildren(icon('stop'), 'Stop sample');
    testStatus.textContent = 'Preparing audio…';
    let failed = false;
    void speak(TEST_SENTENCE, {
      voice: s.ttsVoice || undefined, rate: s.ttsRate,
      onStart: () => { if (mine === testRun) testStatus.textContent = 'Playing Chinese voice sample…'; },
      onError: message => { failed = true; if (mine === testRun) testStatus.textContent = message; },
    }).then(completed => {
      if (mine !== testRun) return;
      playing = false;
      test.replaceChildren(icon('speaker'), 'Test voice');
      if (!failed) testStatus.textContent = completed ? 'Voice sample finished.' : 'Voice sample stopped.';
    });
  });

  const supported = canSpeak();
  if (!supported) {
    select.disabled = true;
    test.disabled = true;
    note.textContent = 'This browser cannot speak text aloud.';
  } else {
    void listChineseVoices().then((list) => {
      voices = list;
      listed = true;
      fill(settings.get().ttsVoice);
      note.textContent = list.length
        ? 'Automatic prefers Premium or Enhanced voices. “Your Mac” voices use your private connection; “on-device” voices run on the device you are reading on. On iPad, add Chinese voices in Settings > Accessibility > Read & Speak (Spoken Content on older iPadOS).'
        : 'No Chinese voices found. Add a Chinese voice in your device’s Accessibility > Read & Speak settings, or connect to your Mac’s private Dushu link, then reopen Dushu.';
    }).catch(() => { listed = true; });
  }

  const el = group('Speech', 'Read words, sentences, or the current chapter aloud. Voices on your Mac highlight each word as it is spoken. Premium voices built into the browser highlight only the paragraph.',
    row('Voice', null, h('div.set-voice', null, select, note), voiceId),
    row('Read-aloud speed', null, rate),
    row('Try it', 'Plays a short sentence with the voice and speed above.', h('div', null, test, testStatus)));
  fill('');

  return {
    el,
    update(s) {
      rate.update(s);
      if (select.value !== s.ttsVoice && (listed || !s.ttsVoice)) fill(s.ttsVoice);
    },
    dispose() { testRun++; stopSpeaking(); },
  };
}
