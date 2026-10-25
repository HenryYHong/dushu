// The Translation group: provider list with live availability, Claude through the Mac (model, Local only, status, test), Chrome model download.
import type { AppContext, Settings, TranslatorId } from '../../types';
import { h } from '../dom';
import { icon } from '../icons';
import { BRIDGE_EVENT, hasMacBridge } from '../../core/macBridge';
import { CLOUD_EVENT, cloudSession } from '../../core/cloud';
import { getTranslator, listTranslators, chromeSupported, type ChromeTranslator } from '../../translate';
import { CLAUDE_MODELS, fetchClaudeStatus, hasClaudeRoute, resetClaudeStatus, type ClaudeStatus } from '../../translate/claude';
import { qualityLocalAvailable } from '../../translate/localMeaning';
import { group, nextId, row, toggle } from './controls';

type Avail = 'yes' | 'download' | 'no';
type Choice = Settings['translator'];

export { CLAUDE_MODELS };

const NAMES: Record<TranslatorId, { name: string; desc: string }> = {
  local: { name: 'Private Mac AI (Ollama)', desc: 'Uses Qwen3.5 9B on your Mac, including from a privately connected iPad. Keep your Mac awake. No cloud API key; AI output still needs checking.' },
  chrome: { name: 'Chrome on-device', desc: 'Built into Chrome 138 or newer on a computer. Private and free; works offline after a one-time model download.' },
  claude: { name: 'Claude (through your Mac)', desc: 'Best quality, and it can explain grammar. Your Mac sends the selected text to Anthropic with a key that stays on the Mac. Needs the Mac awake and reachable.' },
  mymemory: { name: 'MyMemory', desc: 'Free web service, about 5,000 characters a day. Sends the selected text to a third party.' },
  gloss: { name: 'Word-by-word gloss', desc: 'Offline. Shows each word with its first dictionary meaning. Not a real translation.' },
};

export function statusText(id: TranslatorId, a: Avail, claude?: ClaudeStatus | null, localOnly = false): { text: string; kind: 'ok' | 'warn' | 'off' } {
  if (id === 'claude' && localOnly) return { text: 'Local only is on', kind: 'off' };
  if (id === 'mymemory' && localOnly) return { text: 'Local only is on', kind: 'off' };
  if (a === 'yes') return { text: 'Ready', kind: 'ok' };
  if (a === 'download') return { text: 'Download needed', kind: 'warn' };
  if (id === 'claude') {
    const account = !!cloudSession();
    if (!hasClaudeRoute()) return { text: 'Sign in or connect your Mac', kind: 'off' };
    if (claude?.denied) return { text: account ? 'Signed out' : 'Mac refused this device', kind: 'warn' };
    if (!claude?.reachable) return { text: account ? 'Sync server not reachable' : 'Mac not reachable', kind: 'off' };
    if (!claude.configured) return { text: account ? 'No key on the sync server' : 'No key on the Mac', kind: 'warn' };
    if (claude.limitMessage) return { text: 'Daily limit used', kind: 'warn' };
    return { text: 'Unavailable', kind: 'off' };
  }
  if (id === 'chrome') return { text: chromeSupported() ? 'Not available for Chinese' : 'Not supported in this browser', kind: 'off' };
  return { text: 'Unavailable', kind: 'off' };
}

/** Keep the Settings status aligned with pickTranslator. */
export function autoPick(avail: Record<TranslatorId, Avail>, qualityLocal = false, localOnly = false): TranslatorId {
  if (!localOnly && avail.claude === 'yes') return 'claude';
  if (qualityLocal && avail.local === 'yes') return 'local';
  if (avail.chrome === 'yes') return 'chrome';
  if (avail.local !== 'no') return 'local';
  if (avail.chrome !== 'no') return 'chrome';
  return 'gloss';
}

const number = (n: number) => n.toLocaleString('en-US');

/** The lines under "Claude through your Mac": is the Mac there, is the key set up, how much was used today. */
export function claudeStatusLines(status: ClaudeStatus | null, connected: boolean, account = false): { label: string; value: string; kind: 'ok' | 'warn' | 'off' }[] {
  if (account) {
    // Signed in: Claude goes through the account's server, wherever this device is.
    if (!status) return [{ label: 'Account', value: 'Checking…', kind: 'off' }];
    if (status.denied) return [{ label: 'Account', value: 'This device is signed out. Sign in again above.', kind: 'warn' }];
    if (!status.reachable) return [{ label: 'Account', value: 'The sync server did not answer. Check this device’s internet connection.', kind: 'off' }];
    const lines: { label: string; value: string; kind: 'ok' | 'warn' | 'off' }[] = [{ label: 'Account', value: 'Claude goes through your account, wherever you are', kind: 'ok' }];
    lines.push(status.configured
      ? { label: 'Claude key', value: 'Set up on the sync server', kind: 'ok' }
      : { label: 'Claude key', value: status.problem ?? 'Not set up on the sync server', kind: 'warn' });
    if (status.usage) {
      const limits = status.limits ? ` of ${number(status.limits.requests)} requests and ${number(status.limits.inputTokens)} input tokens` : '';
      lines.push({ label: 'Today', value: `${number(status.usage.requests)} ${status.usage.requests === 1 ? 'request' : 'requests'}, ${number(status.usage.inputTokens)} input and ${number(status.usage.outputTokens)} output tokens${limits}`,
        kind: status.limitMessage ? 'warn' : 'ok' });
    }
    if (status.limitMessage) lines.push({ label: 'Limit', value: status.limitMessage, kind: 'warn' });
    return lines;
  }
  if (!connected) return [{ label: 'Mac', value: 'This device is not connected to a Mac. Sign in, or connect it below.', kind: 'off' }];
  if (!status) return [{ label: 'Mac', value: 'Checking…', kind: 'off' }];
  if (status.denied) return [{ label: 'Mac', value: 'It answered but did not accept this device. Sign in to Tailscale with the Mac owner\'s account.', kind: 'warn' }];
  if (!status.reachable) return [{ label: 'Mac', value: 'Not reachable. Keep it awake and connected to Tailscale.', kind: 'off' }];
  const lines: { label: string; value: string; kind: 'ok' | 'warn' | 'off' }[] = [{ label: 'Mac', value: 'Reachable', kind: 'ok' }];
  lines.push(status.configured
    ? { label: 'Claude key', value: status.warning ? `Set up on the Mac. ${status.warning}` : 'Set up on the Mac', kind: status.warning ? 'warn' : 'ok' }
    : { label: 'Claude key', value: status.problem ?? 'Not set up on the Mac', kind: 'warn' });
  if (status.usage) {
    const limits = status.limits ? ` of ${number(status.limits.requests)} requests and ${number(status.limits.inputTokens)} input tokens` : '';
    lines.push({ label: 'Today', value: `${number(status.usage.requests)} ${status.usage.requests === 1 ? 'request' : 'requests'}, ${number(status.usage.inputTokens)} input and ${number(status.usage.outputTokens)} output tokens${limits}`,
      kind: status.limitMessage ? 'warn' : 'ok' });
  }
  if (status.limitMessage) lines.push({ label: 'Limit', value: status.limitMessage, kind: 'warn' });
  return lines;
}

export function translationGroup(ctx: AppContext): { el: HTMLElement; update(s: Settings): void; dispose(): void } {
  const { settings } = ctx;
  const ids: TranslatorId[] = ['local', 'chrome', 'claude', 'mymemory', 'gloss'];
  const avail: Record<TranslatorId, Avail> = { local: 'no', chrome: 'no', claude: 'no', mymemory: 'yes', gloss: 'yes' };
  const name = nextId('tr');
  let claudeStatus: ClaudeStatus | null = null;
  let alive = true;
  let shownLocalOnly = settings.get().localOnly;

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
    rowEl('auto', 'Automatic', 'Claude through your Mac when it is set up, then the Qwen3.5 9B model on your Mac, ready browser translation, smaller local models, and the dictionary. Local only skips Claude.'),
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

  // Claude status block
  const statusBox = h('dl.set-status', { role: 'status', 'aria-live': 'polite' });
  function paintStatus() {
    statusBox.replaceChildren(...claudeStatusLines(claudeStatus, hasMacBridge(), !!cloudSession()).flatMap(line => [
      h('dt', null, line.label),
      h('dd', { class: `set-status-${line.kind}` }, line.value),
    ]));
  }

  async function refresh(force = false): Promise<void> {
    if (force) { resetClaudeStatus(); claudeStatus = null; paintStatus(); }
    try {
      claudeStatus = await fetchClaudeStatus({ force });
    } catch { /* keep the last known state */ }
    if (!alive) return;
    try {
      const rows = await listTranslators(settings.get(), ctx.dictSync());
      for (const r of rows) avail[r.translator.id] = r.availability;
    } catch { /* keep the last known state */ }
    if (!alive) return;
    const localOnly = settings.get().localOnly;
    for (const id of ids) {
      const st = statusText(id, avail[id], claudeStatus, localOnly);
      paintChip(id, st.text, st.kind);
    }
    const pick = autoPick(avail, avail.local === 'yes' && await qualityLocalAvailable(), localOnly);
    if (!alive) return;
    paintChip('auto', `Using ${NAMES[pick].name}`, 'ok');
    dlBtn.hidden = avail.chrome !== 'download';
    paintStatus();
  }

  const modelId = nextId('model');
  const model = h('select.select', { id: modelId, 'aria-label': 'Claude model' }, ...CLAUDE_MODELS.map((m) => h('option', { value: m.value }, m.label))) as HTMLSelectElement;
  model.addEventListener('change', () => settings.set({ claudeModel: model.value }));

  const localOnly = toggle('localOnly', 'Local only: keep every sentence on this Mac', (v) => settings.set({ localOnly: v }));

  const testOut = h('div.set-test-out', { role: 'status', 'aria-live': 'polite' });
  const testBtn = h('button.btn.btn-sm', { type: 'button' }, 'Test Claude') as HTMLButtonElement;
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testOut.className = 'set-test-out';
    testOut.textContent = 'Testing…';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30000);
    try {
      const out = await getTranslator('claude', settings.get(), ctx.dictSync()).translate({ text: '你好，世界。', mode: 'translate' }, { signal: ac.signal });
      testOut.className = 'set-test-out set-good';
      testOut.textContent = `Works. “你好，世界。” came back as “${out.slice(0, 120)}”`;
    } catch (e) {
      testOut.className = 'set-test-out set-bad';
      const aborted = (e as { name?: string })?.name === 'AbortError';
      testOut.textContent = aborted ? 'Claude did not answer within 30 seconds.' : e instanceof Error ? e.message : 'The test failed.';
    } finally {
      clearTimeout(timer);
      testBtn.disabled = settings.get().localOnly;
      void refresh(true);
    }
  });
  const refreshBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => void refresh(true) }, icon('refresh'), 'Check again') as HTMLButtonElement;

  const claudeBox = h('div.set-claude', null,
    h('div.set-claude-title', null, 'Claude through your Mac'),
    h('p.set-claude-note', null, 'The key stays in a file on your Mac and never reaches this browser, your settings or a backup.'),
    row('Model', 'Sonnet gives the best Chinese for the price. Haiku costs less.', h('div.set-model-row', null, model), modelId),
    row('Local only', 'Keep every sentence on this Mac: no Claude and no MyMemory. Sentences go only to the model on your Mac, Chrome\'s on-device translator, or the dictionary.', localOnly),
    row('Status', 'Checked on your Mac. Today\'s limit protects your Anthropic bill.', h('div.set-status-wrap', null, statusBox, h('div.set-test', null, h('div.set-btn-row', null, refreshBtn, testBtn), testOut))));

  const el = group('Translation',
    'Pick what translates sentences you select. Word cards also offer an optional on-device context suggestion when Ollama is available.',
    h('div.set-prov-wrap', null, list),
    claudeBox);

  const onBridge = () => { resetClaudeStatus(); void refresh(true); };
  window.addEventListener(BRIDGE_EVENT, onBridge);
  window.addEventListener(CLOUD_EVENT, onBridge);
  paintStatus();
  void refresh();
  // The gloss translator is only available once the dictionary has loaded.
  void ctx.dict().then(() => refresh(), () => {});

  return {
    el,
    update(s) {
      for (const [v, input] of radios) input.checked = s.translator === v;
      localOnly.update(s);
      testBtn.disabled = s.localOnly;
      testBtn.title = s.localOnly ? 'Local only is on, so Claude is not used.' : '';
      if (s.localOnly !== shownLocalOnly) { shownLocalOnly = s.localOnly; void refresh(); }
      if (model.value !== s.claudeModel) model.value = s.claudeModel;
    },
    dispose() {
      alive = false;
      window.removeEventListener(BRIDGE_EVENT, onBridge);
      window.removeEventListener(CLOUD_EVENT, onBridge);
    },
  };
}
