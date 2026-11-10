// The Translation group: the language to translate into, provider list with live availability, Local only, Claude through the
// Mac or the owner's account (model, status, test), Chrome model download. The Mac's providers (Claude, the model on the Mac)
// show only where there is a Mac to use, or for the owner signed in; a visitor sees what can work for them.
import { glossLanguage } from '../../lang/labels';
import type { AppContext, Settings, TranslatorId } from '../../types';
import { h } from '../dom';
import { icon } from '../icons';
import { BRIDGE_EVENT, hasMacBridge, isMacOrigin } from '../../core/macBridge';
import { CLOUD_EVENT, cloudSession, isAccountOwner } from '../../core/cloud';
import { getTranslator, listTranslators, chromeSupported, translateTarget, type ChromeTranslator } from '../../translate';
import { chromePairName } from '../../translate/chrome';
import { DEFAULT_TARGET, targetFor, targetLanguage, targetsFor } from '../../translate/targets';
import { CLAUDE_MODELS, fetchClaudeStatus, hasClaudeRoute, resetClaudeStatus, type ClaudeStatus } from '../../translate/claude';
import { qualityLocalAvailable } from '../../translate/localMeaning';
import { group, nextId, row, toggle } from './controls';
import { lang, langId } from '../../lang/active';

type Avail = 'yes' | 'download' | 'no';
type Choice = Settings['translator'];

export { CLAUDE_MODELS };

const NAMES: Record<TranslatorId, { name: string; desc: string }> = {
  local: { name: 'Private Mac AI (Ollama)', desc: 'Qwen3.5 9B, running on your Mac. The Mac has to be awake.' },
  chrome: { name: 'Chrome on-device', desc: 'Built into Chrome 138 and newer on a computer. Free, and works offline after a one-time download.' },
  claude: { name: 'Claude (through your Mac)', desc: 'The best translations, and it can explain grammar. Goes through your Mac, which has to be awake.' },
  account: { name: 'Qwen (through your account)', desc: 'Free when you’re signed in, up to a daily limit. Runs on Cloudflare.' },
  mymemory: { name: 'MyMemory', desc: 'A free online service, about 5,000 characters a day. Your sentence is sent to it.' },
  gloss: { name: 'Word-by-word gloss', desc: 'Each word with its first dictionary meaning. Works offline, but it is not a real translation.' },
};

/** The names as they read now: signed in, Claude goes through the account's sync server, not the Mac. */
export function claudeNames(): typeof NAMES {
  return cloudSession() ? { ...NAMES, claude: {
    name: 'Claude (through your account)',
    desc: 'The best translations, and it can explain grammar. Goes through your account.',
  } } : NAMES;
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** `to`: the language translated into, for Chrome, whose models come one pair at a time (Chinese to French is its own). */
export function statusText(id: TranslatorId, a: Avail, claude?: ClaudeStatus | null, localOnly = false, to: string = DEFAULT_TARGET): { text: string; kind: 'ok' | 'warn' | 'off' } {
  if (id === 'claude' && localOnly) return { text: 'Local only is on', kind: 'off' };
  if ((id === 'mymemory' || id === 'account') && localOnly) return { text: 'Local only is on', kind: 'off' };
  // Both need the internet: offline they are not used up or missing a sign-in, only out of reach.
  if ((id === 'mymemory' || id === 'account') && offline() && a === 'no') return { text: 'Offline', kind: 'off' };
  if (a === 'yes') return { text: 'Ready', kind: 'ok' };
  if (a === 'download') return { text: 'Download needed', kind: 'warn' };
  if (id === 'claude') {
    const account = !!cloudSession();
    if (!hasClaudeRoute()) return { text: 'Sign in or connect your Mac', kind: 'off' };
    if (claude?.denied) return { text: account ? 'Signed out' : 'Mac refused this device', kind: 'warn' };
    if (!claude?.reachable) return { text: account ? 'Sync server not reachable' : 'Mac not reachable', kind: 'off' };
    if (claude.ownerOnly) return { text: 'Only for the owner', kind: 'off' };
    if (!claude.configured) return { text: account ? 'No key on the sync server' : 'No key on the Mac', kind: 'warn' };
    if (claude.limitMessage) return { text: 'Daily limit used', kind: 'warn' };
    return { text: 'Unavailable', kind: 'off' };
  }
  if (id === 'chrome') return { text: chromeSupported() ? `Not available for ${chromePairName(to)}` : 'Not supported in this browser', kind: 'off' };
  if (id === 'account') return cloudSession() ? { text: 'Used up for today', kind: 'warn' } : { text: 'Sign in to use', kind: 'off' };
  return { text: 'Unavailable', kind: 'off' };
}

/** Keep the Settings status aligned with pickTranslator. Offline, a Chrome model that still has to be downloaded is passed over. */
export function autoPick(avail: Record<TranslatorId, Avail>, qualityLocal = false, localOnly = false, isOffline = offline()): TranslatorId {
  if (!localOnly && avail.claude === 'yes') return 'claude';
  if (qualityLocal && avail.local === 'yes') return 'local';
  if (!localOnly && avail.account === 'yes') return 'account';
  if (avail.chrome === 'yes') return 'chrome';
  if (avail.local !== 'no') return 'local';
  if (avail.chrome !== 'no' && !isOffline) return 'chrome';
  return 'gloss';
}

const number = (n: number) => n.toLocaleString('en-US');

/**
 * The "Translate into" control: every listed language but the book's own, the library's default first (English, or Chinese in
 * the English library) and the rest by name. When the reader chose the book's own language (Spanish picked while reading
 * Chinese, now in the Spanish library), these books go into the default and the note says why.
 */
export function targetControl(settings: AppContext['settings']): { el: HTMLElement; id: string; update(s: Settings): void } {
  const id = nextId('into');
  const def = targetFor(undefined, langId());
  const all = targetsFor(langId());
  const choices = [...all.filter((t) => t.code === def), ...all.filter((t) => t.code !== def).sort((a, b) => a.name.localeCompare(b.name, 'en'))];
  const select = h('select.select', { id, 'aria-label': 'Translate into' },
    ...choices.map((t) => h('option', { value: t.code }, t.native === t.name ? t.name : `${t.name} · ${t.native}`))) as HTMLSelectElement;
  select.addEventListener('change', () => settings.set({ translateTo: select.value }));
  const note = h('div.set-help', { role: 'status' });
  note.hidden = true;
  return {
    el: h('div', null, select, note),
    id,
    update(s) {
      const to = translateTarget(s);
      if (select.value !== to) select.value = to;
      // Only a language the reader chose (the shared choice has a time): the English library's default 'en' was never chosen.
      const own = s.translateTo !== to && settings.chosenAt?.('translateTo') !== undefined ? targetLanguage(s.translateTo) : undefined;
      note.hidden = !own;
      note.textContent = own ? `These books are in ${lang().name}, so they are translated into ${targetLanguage(to)?.name ?? 'English'}. ${own.name} is used for your other books.` : '';
    },
  };
}

/** The lines under "Claude through your Mac": is the Mac there, is the key set up, how much was used today. */
export function claudeStatusLines(status: ClaudeStatus | null, connected: boolean, account = false): { label: string; value: string; kind: 'ok' | 'warn' | 'off' }[] {
  if (account) {
    // Signed in: Claude goes through the account's server, wherever this device is.
    if (!status) return [{ label: 'Account', value: 'Checking…', kind: 'off' }];
    if (status.denied) return [{ label: 'Account', value: 'This device is signed out. Sign in again above.', kind: 'warn' }];
    if (!status.reachable) return [{ label: 'Account', value: 'The sync server did not answer. Check this device’s internet connection.', kind: 'off' }];
    if (status.ownerOnly) return [{ label: 'Claude', value: status.problem ?? 'Claude translation is only for the owner of this site.', kind: 'off' }];
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
  const ids: TranslatorId[] = ['local', 'chrome', 'claude', 'account', 'mymemory', 'gloss'];
  const avail: Record<TranslatorId, Avail> = { local: 'no', chrome: 'no', claude: 'no', account: 'no', mymemory: 'yes', gloss: 'yes' };
  const name = nextId('tr');
  let claudeStatus: ClaudeStatus | null = null;
  let alive = true;
  let shownLocalOnly = settings.get().localOnly;

  // provider rows
  const radios = new Map<Choice, HTMLInputElement>();
  const chips = new Map<Choice, HTMLElement>();
  const extras = new Map<Choice, HTMLElement>();
  const descs = new Map<Choice, HTMLElement>();
  const titles = new Map<Choice, HTMLElement>();
  const rowEls = new Map<Choice, HTMLElement>();
  const rowEl = (value: Choice, title: string, desc: string): HTMLElement => {
    const input = h('input.set-radio', { type: 'radio', name, value }) as HTMLInputElement;
    input.addEventListener('change', () => { if (input.checked) settings.set({ translator: value }); });
    radios.set(value, input);
    const chip = h('span.set-chip', null, '…');
    chips.set(value, chip);
    const extra = h('div.set-prov-extra');
    extras.set(value, extra);
    const help = h('span.set-help', null, desc);
    descs.set(value, help);
    const titleEl = h('span.set-prov-name', null, title);
    titles.set(value, titleEl);
    const el = h('label.set-prov', null, input,
      h('span.set-prov-text', null, titleEl, help, extra),
      chip);
    rowEls.set(value, el);
    return el;
  };
  const list = h('div.set-prov-list', { role: 'radiogroup', 'aria-label': 'Translation provider' },
    rowEl('auto', 'Automatic', ''),
    ...ids.map((id) => rowEl(id, NAMES[id].name, NAMES[id].desc)));

  /** Whether this device has the owner's Mac to use: the page is the Mac's, or connected to it. */
  const macHere = () => isMacOrigin() || hasMacBridge();
  /**
   * Claude is the owner's: where the Mac is, or signed in to the owner's account. A visitor (signed out off the Mac, or signed
   * in to their own account, which the server says is not the owner's) never sees its rows or the Claude box.
   */
  const claudeHere = () => (macHere() || (!!cloudSession() && isAccountOwner())) && !claudeStatus?.ownerOnly;

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
      const st = statusText(id, avail[id], claudeStatus, localOnly, translateTarget(settings.get()));
      paintChip(id, st.text, st.kind);
    }
    const pick = autoPick(avail, avail.local === 'yes' && await qualityLocalAvailable(), localOnly);
    if (!alive) return;
    paintChip('auto', `Using ${claudeNames()[pick].name}`, 'ok');
    dlBtn.hidden = avail.chrome !== 'download';
    paintStatus();
    paintNames();
  }

  const modelId = nextId('model');
  const model = h('select.select', { id: modelId, 'aria-label': 'Claude model' }, ...CLAUDE_MODELS.map((m) => h('option', { value: m.value }, m.label))) as HTMLSelectElement;
  model.addEventListener('change', () => settings.set({ claudeModel: model.value }));

  const localOnly = toggle('localOnly', `Local only: keep every sentence on this ${isMacOrigin() ? 'Mac' : 'device'}`, (v) => settings.set({ localOnly: v }));

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

  const claudeTitle = h('div.set-claude-title');
  const claudeBox = h('div.set-claude', null,
    claudeTitle,
    row('Model', 'Haiku costs less.', h('div.set-model-row', null, model), modelId),
    row('Status', 'There is a daily limit, so the bill stays small.', h('div.set-status-wrap', null, statusBox, h('div.set-test', null, h('div.set-btn-row', null, refreshBtn, testBtn), testOut))));

  /**
   * The words and rows that depend on where this device is and who is signed in: Claude through the account or the Mac, and
   * which providers there are at all. Painted at mount and again on signing in or out and on connecting a Mac.
   */
  function paintNames(): void {
    const names = claudeNames();
    const account = !!cloudSession();
    titles.get('claude')!.textContent = names.claude.name;
    descs.get('claude')!.textContent = names.claude.desc;
    claudeTitle.textContent = account ? 'Claude through your account' : 'Claude through your Mac';
    const claude = claudeHere();
    const mac = macHere();
    // A row stays while it is the reader's choice, so the choice is never hidden.
    const chosen = settings.get().translator;
    rowEls.get('claude')!.hidden = !claude && chosen !== 'claude';
    rowEls.get('local')!.hidden = !mac && chosen !== 'local';
    claudeBox.hidden = !claude;
    const steps = [
      ...(claude ? [`Claude through your ${account ? 'account' : 'Mac'}`] : []),
      ...(mac ? ['the model on your Mac'] : []),
      account ? 'Qwen through your account' : 'Qwen when you are signed in',
      'the browser’s translator',
    ];
    descs.get('auto')!.textContent = `Tries ${steps.join(', then ')}, and last the word-by-word gloss.`;
  }

  const into = targetControl(settings);
  const el = group('Translation',
    'What translates a sentence when you tap a word twice or drag across it.',
    row('Translate into', 'The language translations are written in. The app itself stays in English.', into, into.id),
    h('div.set-prov-wrap', null, list),
    row('Local only', 'Never send a sentence to an online translator.', localOnly),
    claudeBox);

  const onBridge = () => { resetClaudeStatus(); paintNames(); void refresh(true); };
  // The chips follow the connection: offline, Qwen and MyMemory say so instead of "Used up for today".
  const onLine = () => { void refresh(); };
  window.addEventListener(BRIDGE_EVENT, onBridge);
  window.addEventListener(CLOUD_EVENT, onBridge);
  window.addEventListener('online', onLine);
  window.addEventListener('offline', onLine);
  paintNames();
  paintStatus();
  void refresh();
  // The gloss translator is only available once the dictionary has loaded.
  void ctx.dict().then(() => refresh(), () => {});

  let shownTarget = translateTarget(settings.get());
  return {
    el,
    update(s) {
      into.update(s);
      // The dictionaries behind the gloss only give English, whatever language the reader translates into.
      descs.get('gloss')!.textContent = translateTarget(s) === DEFAULT_TARGET ? NAMES.gloss.desc
        : `Each word with its first dictionary meaning, in ${glossLanguage()}. Works offline, but it is not a real translation.`;
      // Chrome's model, and so whether it is ready, depends on the language translated into.
      if (translateTarget(s) !== shownTarget) { shownTarget = translateTarget(s); void refresh(); }
      for (const [v, input] of radios) input.checked = s.translator === v;
      paintNames();
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
      window.removeEventListener('online', onLine);
      window.removeEventListener('offline', onLine);
    },
  };
}
