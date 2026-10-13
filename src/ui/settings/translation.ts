// The Translation group: provider list with live availability, Claude key/model/test, Chrome model download.
import type { AppContext, Settings, TranslatorId } from '../../types';
import { h } from '../dom';
import { icon } from '../icons';
import { getTranslator, listTranslators, chromeSupported, type ChromeTranslator } from '../../translate';
import { group, nextId, row } from './controls';
import { qualityLocalAvailable } from '../../translate/localMeaning';

type Avail = 'yes' | 'download' | 'no';
type Choice = Settings['translator'];

export const CLAUDE_MODELS: { value: string; label: string }[] = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality, default)' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster)' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, lowest cost)' },
];

const NAMES: Record<TranslatorId, { name: string; desc: string }> = {
  local: { name: 'Private Mac AI (Ollama)', desc: 'Uses Qwen3.5 9B on your Mac, including from a privately connected iPad. Keep your Mac awake. No cloud API key; AI output still needs checking.' },
  chrome: { name: 'Chrome on-device', desc: 'Built into Chrome 138 or newer on a computer. Private and free; works offline after a one-time model download.' },
  claude: { name: 'Claude (your API key)', desc: 'Best quality, and it can explain grammar. Sends the selected text to Anthropic using your own key.' },
  mymemory: { name: 'MyMemory', desc: 'Free web service, about 5,000 characters a day. Sends the selected text to a third party.' },
  gloss: { name: 'Word-by-word gloss', desc: 'Offline. Shows each word with its first dictionary meaning. Not a real translation.' },
};

export function statusText(id: TranslatorId, a: Avail): { text: string; kind: 'ok' | 'warn' | 'off' } {
  if (a === 'yes') return { text: 'Ready', kind: 'ok' };
  if (a === 'download') return { text: 'Download needed', kind: 'warn' };
  if (id === 'claude') return { text: 'Needs an API key', kind: 'off' };
  if (id === 'chrome') return { text: chromeSupported() ? 'Not available for Chinese' : 'Not supported in this browser', kind: 'off' };
  return { text: 'Unavailable', kind: 'off' };
}

/** Keep the Settings status aligned with pickTranslator. */
export function autoPick(avail: Record<TranslatorId, Avail>, qualityLocal = false): TranslatorId {
  if (qualityLocal && avail.local === 'yes') return 'local';
  if (avail.chrome === 'yes') return 'chrome';
  if (avail.local !== 'no') return 'local';
  if (avail.chrome !== 'no') return 'chrome';
  if (avail.claude !== 'no') return 'claude';
  return 'gloss';
}

export function translationGroup(ctx: AppContext): { el: HTMLElement; update(s: Settings): void } {
  const { settings } = ctx;
  const ids: TranslatorId[] = ['local', 'chrome', 'claude', 'mymemory', 'gloss'];
  const avail: Record<TranslatorId, Avail> = { local: 'no', chrome: 'no', claude: 'no', mymemory: 'yes', gloss: 'yes' };
  const name = nextId('tr');

  // provider rows
  const radios = new Map<Choice, HTMLInputElement>();
  const chips = new Map<Choice, HTMLElement>();
  const extras = new Map<Choice, HTMLElement>();
  const rowEl = (value: Choice, title: string, desc: string): HTMLElement => {
    const input = h('input.set-radio', { type: 'radio', name, value }) as HTMLInputElement;
    input.addEventListener('change', () => { if (input.checked) settings.set({ translator: value }); });
    radios.set(value, input);
    const chip = h('span.set-chip', null, '…');
    chips.set(value, chip);
    const extra = h('div.set-prov-extra');
    extras.set(value, extra);
    return h('label.set-prov', null, input,
      h('span.set-prov-text', null, h('span.set-prov-name', null, title), h('span.set-help', null, desc), extra),
      chip);
  };
  const list = h('div.set-prov-list', { role: 'radiogroup', 'aria-label': 'Translation provider' },
    rowEl('auto', 'Automatic', 'Prefers the evaluated Qwen3.5 9B model on this Mac, then ready browser translation. Falls back to smaller local models, a browser download, your Claude key, or the dictionary.'),
    ...ids.map((id) => rowEl(id, NAMES[id].name, NAMES[id].desc)));

  function paintChip(value: Choice, text: string, kind: 'ok' | 'warn' | 'off') {
    const chip = chips.get(value)!;
    chip.textContent = text;
    chip.className = `set-chip set-chip-${kind}`;
  }

  // Chrome download
  const dlNote = h('div.set-prov-note');
  const dlBtn = h('button.btn.btn-sm', { type: 'button' }, icon('download'), 'Download model') as HTMLButtonElement;
  dlBtn.hidden = true;
  dlBtn.addEventListener('click', async () => {
    dlBtn.disabled = true;
    dlNote.textContent = '';
    try {
      await (getTranslator('chrome', settings.get(), ctx.dictSync()) as ChromeTranslator).prepare((f) => {
        dlBtn.lastChild!.textContent = `Downloading ${Math.round(f * 100)}%`;
      });
      dlNote.textContent = 'The model is ready.';
    } catch (e) {
      dlNote.textContent = e instanceof Error ? e.message : 'The download failed. Try again.';
    }
    dlBtn.lastChild!.textContent = 'Download model';
    dlBtn.disabled = false;
    void refresh();
  });
  extras.get('chrome')!.append(dlBtn, dlNote);

  async function refresh(): Promise<void> {
    try {
      const rows = await listTranslators(settings.get(), ctx.dictSync());
      for (const r of rows) avail[r.translator.id] = r.availability;
    } catch { /* keep the last known state */ }
    for (const id of ids) {
      const st = statusText(id, avail[id]);
      paintChip(id, st.text, st.kind);
    }
    const pick = autoPick(avail, avail.local === 'yes' && await qualityLocalAvailable());
    paintChip('auto', `Using ${NAMES[pick].name}`, 'ok');
    dlBtn.hidden = avail.chrome !== 'download';
  }

  // Claude key, model, test
  const keyId = nextId('key');
  const key = h('input.input.set-key', { id: keyId, type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…', 'aria-label': 'Anthropic API key' }) as HTMLInputElement;
  const reveal = h('button.icon-btn', { type: 'button', 'aria-label': 'Show key', 'aria-pressed': 'false' }, icon('eye')) as HTMLButtonElement;
  reveal.addEventListener('click', () => {
    const show = key.type === 'password';
    key.type = show ? 'text' : 'password';
    reveal.setAttribute('aria-pressed', String(show));
    reveal.setAttribute('aria-label', show ? 'Hide key' : 'Show key');
    reveal.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
  });
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  key.addEventListener('input', () => {
    settings.set({ claudeApiKey: key.value });
    testOut.textContent = '';
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), 250);
  });

  const modelId = nextId('model');
  const model = h('select.select', { id: modelId, 'aria-label': 'Claude model' }) as HTMLSelectElement;
  model.addEventListener('change', () => settings.set({ claudeModel: model.value }));

  const testOut = h('div.set-test-out', { role: 'status', 'aria-live': 'polite' });
  const testBtn = h('button.btn.btn-sm', { type: 'button' }, 'Test key') as HTMLButtonElement;
  testBtn.addEventListener('click', async () => {
    const s = { ...settings.get(), claudeApiKey: key.value.trim(), claudeModel: model.value };
    if (!s.claudeApiKey) { testOut.className = 'set-test-out set-bad'; testOut.textContent = 'Enter a key first.'; return; }
    testBtn.disabled = true;
    testOut.className = 'set-test-out';
    testOut.textContent = 'Testing…';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30000);
    try {
      const out = await getTranslator('claude', s, ctx.dictSync()).translate({ text: '你好，世界。', mode: 'translate' }, { signal: ac.signal });
      testOut.className = 'set-test-out set-good';
      testOut.textContent = `Works. “你好，世界。” came back as “${out.slice(0, 120)}”`;
    } catch (e) {
      testOut.className = 'set-test-out set-bad';
      const aborted = (e as { name?: string })?.name === 'AbortError';
      testOut.textContent = aborted ? 'Claude did not answer within 30 seconds.' : e instanceof Error ? e.message : 'The test failed.';
    } finally {
      clearTimeout(timer);
      testBtn.disabled = false;
    }
  });

  const claudeBox = h('div.set-claude', null,
    row('Anthropic API key', 'Stored only in this browser and left out of backups. Get one at console.anthropic.com.',
      h('div.set-key-row', null, key, reveal), keyId),
    row('Model', 'Opus gives the best Chinese. Sonnet and Haiku are faster and cost less.', h('div.set-model-row', null, model), modelId),
    row('Check the key', 'Sends one short test sentence.', h('div.set-test', null, testBtn, testOut)));

  const el = group('Translation',
    'Pick what translates sentences you select. Word cards also offer an optional on-device context suggestion when Ollama is available.',
    h('div.set-prov-wrap', null, list),
    claudeBox);

  void refresh();
  // The gloss translator is only available once the dictionary has loaded.
  void ctx.dict().then(() => refresh(), () => {});

  return {
    el,
    update(s) {
      for (const [v, input] of radios) input.checked = s.translator === v;
      if (document.activeElement !== key && key.value !== s.claudeApiKey) key.value = s.claudeApiKey;
      const models = CLAUDE_MODELS.some((m) => m.value === s.claudeModel)
        ? CLAUDE_MODELS
        : [...CLAUDE_MODELS, { value: s.claudeModel, label: `${s.claudeModel} (custom)` }];
      if (model.options.length !== models.length || model.value !== s.claudeModel) {
        model.replaceChildren(...models.map((m) => h('option', { value: m.value }, m.label)));
        model.value = s.claudeModel;
      }
    },
  };
}
