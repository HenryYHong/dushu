// The Speech group: voice list, rate, and a test button.
import type { AppContext, Settings } from '../../types';
import { h } from '../dom';
import { icon } from '../icons';
import { canSpeak, listChineseVoices, listVoicesFor, speak, stopSpeaking, voiceLabel } from '../../speech/tts';
import { isChinese, lang } from '../../lang/active';
import { SAMPLE_SENTENCES } from '../../lang/samples';
import { group, nextId, row, slider } from './controls';
import { langName, tt, uiLocale } from '../../i18n';

export const TEST_SENTENCE = '你好，欢迎使用读书。今天我们一起读一本书。';
/** The language the voices speak, by its name in the app's language. */
const voiceLang = () => (isChinese() ? langName('zh', 'Chinese') : langName(lang().id, lang().name));

/** The read-aloud speed as the reader's menu and audio strip show it: 0.9×, 1×, 1.25× (0,9× in French). */
export const rateLabel = (n: number): string => `${new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: 2 }).format(n)}×`;

export function speechGroup(ctx: AppContext): { el: HTMLElement; update(s: Settings): void; dispose(): void } {
  const { settings } = ctx;
  const voiceId = nextId('voice');
  const select = h('select.select', { id: voiceId, 'aria-label': tt('Voice') }) as HTMLSelectElement;
  const note = h('div.set-help.set-voice-note');
  let voices: SpeechSynthesisVoice[] = [];
  let listed = false;

  const fill = (current: string) => {
    const opts = [h('option', { value: '' }, tt('Automatic (best {language} voice)', { language: voiceLang() }))];
    for (const v of voices) opts.push(h('option', { value: v.voiceURI }, voiceLabel(v)));
    // A saved voice that is not installed here (another machine) stays visible instead of silently resetting.
    if (current && !voices.some((v) => v.voiceURI === current || v.name === current)) opts.push(h('option', { value: current }, tt('{voice} (not installed)', { voice: current })));
    select.replaceChildren(...opts);
    select.value = current;
  };
  select.addEventListener('change', () => settings.set({ ttsVoice: select.value }));

  const rate = slider('ttsRate', tt('Read-aloud speed'), { min: 0.5, max: 2, step: 0.05, format: rateLabel }, (v) => settings.set({ ttsRate: v }));

  const test = h('button.btn.btn-sm', { type: 'button' }, icon('speaker'), tt('Test voice')) as HTMLButtonElement;
  const testStatus = h('div.set-help', { role: 'status', 'aria-live': 'polite' });
  let playing = false;
  let testRun = 0;
  test.addEventListener('click', () => {
    if (playing) {
      testRun++;
      stopSpeaking();
      playing = false;
      test.replaceChildren(icon('speaker'), tt('Test voice'));
      testStatus.textContent = tt('Voice sample stopped.');
      return;
    }
    const s = settings.get();
    const mine = ++testRun;
    playing = true;
    test.replaceChildren(icon('stop'), tt('Stop sample'));
    testStatus.textContent = tt('Preparing audio…');
    let failed = false;
    void speak(isChinese() ? TEST_SENTENCE : SAMPLE_SENTENCES[lang().id], {
      voice: s.ttsVoice || undefined, rate: s.ttsRate,
      onStart: () => { if (mine === testRun) testStatus.textContent = tt('Playing {language} voice sample…', { language: voiceLang() }); },
      onError: message => { failed = true; if (mine === testRun) testStatus.textContent = message; },
    }).then(completed => {
      if (mine !== testRun) return;
      playing = false;
      test.replaceChildren(icon('speaker'), tt('Test voice'));
      if (!failed) testStatus.textContent = completed ? tt('Voice sample finished.') : tt('Voice sample stopped.');
    });
  });

  const supported = canSpeak();
  /**
   * Lists the voices again. A browser can load its voices after Settings opened (voiceschanged), and the Mac's voices come
   * from the bridge: each listing is numbered, so an older, slower one never replaces a newer one.
   */
  let listRun = 0;
  const relist = () => {
    const mine = ++listRun;
    void (isChinese() ? listChineseVoices() : listVoicesFor(lang().tag)).then((list) => {
      if (mine !== listRun) return;
      voices = list;
      listed = true;
      fill(settings.get().ttsVoice);
      note.textContent = list.length
        ? tt('Automatic picks the best voice you have. On iPad you can add {language} voices in Settings > Accessibility > Read & Speak.', { language: voiceLang() })
        : tt('No {language} voices found. Add one in your device’s Accessibility > Read & Speak settings, then reopen Settings.', { language: voiceLang() });
    }).catch(() => {
      if (mine !== listRun) return;
      listed = true;
      note.textContent = '';
    });
  };
  if (!supported) {
    select.disabled = true;
    test.disabled = true;
    note.textContent = tt('This browser cannot speak text aloud.');
  } else {
    note.textContent = tt('Looking for voices…');
    relist();
    speechSynthesis.addEventListener('voiceschanged', relist);
  }

  const el = group(tt('Speech'), null,
    row(tt('Voice'), null, h('div.set-voice', null, select, note), voiceId),
    row(tt('Read-aloud speed'), null, rate),
    row(tt('Try it'), null, h('div', null, test, testStatus)));
  fill('');

  return {
    el,
    update(s) {
      rate.update(s);
      if (select.value !== s.ttsVoice && (listed || !s.ttsVoice)) fill(s.ttsVoice);
    },
    dispose() {
      testRun++;
      stopSpeaking();
      listRun++;
      if (supported) speechSynthesis.removeEventListener('voiceschanged', relist);
    },
  };
}
