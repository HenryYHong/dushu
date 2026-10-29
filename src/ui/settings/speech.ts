// The Speech group: voice list, rate, and a test button.
import type { AppContext, Settings } from '../../types';
import { h } from '../dom';
import { icon } from '../icons';
import { canSpeak, listChineseVoices, listVoicesFor, speak, stopSpeaking, voiceLabel } from '../../speech/tts';
import { isChinese, lang } from '../../lang/active';
import { SAMPLE_SENTENCES } from '../../lang/samples';
import { group, nextId, row, slider } from './controls';

export const TEST_SENTENCE = '你好，欢迎使用读书。今天我们一起读一本书。';
const langName = () => (isChinese() ? 'Chinese' : lang().name);

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
    const opts = [h('option', { value: '' }, `Automatic (best ${langName()} voice)`)];
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
    void speak(isChinese() ? TEST_SENTENCE : SAMPLE_SENTENCES[lang().id], {
      voice: s.ttsVoice || undefined, rate: s.ttsRate,
      onStart: () => { if (mine === testRun) testStatus.textContent = `Playing ${langName()} voice sample…`; },
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
    void (isChinese() ? listChineseVoices() : listVoicesFor(lang().tag)).then((list) => {
      voices = list;
      listed = true;
      fill(settings.get().ttsVoice);
      note.textContent = list.length
        ? `Automatic picks the best voice you have. On iPad you can add ${langName()} voices in Settings > Accessibility > Read & Speak.`
        : `No ${langName()} voices found. Add one in your device’s Accessibility > Read & Speak settings, then reopen Dushu.`;
    }).catch(() => { listed = true; });
  }

  const el = group('Speech', null,
    row('Voice', null, h('div.set-voice', null, select, note), voiceId),
    row('Read-aloud speed', null, rate),
    row('Try it', null, h('div', null, test, testStatus)));
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
