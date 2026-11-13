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
import { group, more, nextId, row, toggle } from './controls';
import { lang, langId } from '../../lang/active';
import { langName, num, tt, ttm, ttn, uiLocale } from '../../i18n';

type Avail = 'yes' | 'download' | 'no';
type Choice = Settings['translator'];

export { CLAUDE_MODELS };

// In English here; claudeNames() gives them in the app's language.
const NAMES: Record<TranslatorId, { name: string; desc: string }> = {
  local: { name: ttm('Private Mac AI (Ollama)'), desc: ttm('Qwen3.5 9B, running on your Mac. The Mac has to be awake.') },
  chrome: { name: ttm('Chrome on-device'), desc: ttm('Built into Chrome 138 and newer on a computer. Free, and works offline after a one-time download.') },
  claude: { name: ttm('Claude (through your Mac)'), desc: ttm('The best translations, and it can explain grammar. Goes through your Mac, which has to be awake.') },
  account: { name: ttm('Qwen (through your account)'), desc: ttm('Free when you’re signed in, up to a daily limit. Runs on Cloudflare.') },
  mymemory: { name: 'MyMemory', desc: ttm('A free online service, about 5,000 characters a day. Your sentence is sent to it.') },
  gloss: { name: ttm('Word-by-word gloss'), desc: ttm('Each word with its first dictionary meaning. Works offline, but it is not a real translation.') },
};

/** The names as they read now, in the app's language: signed in, Claude goes through the account's sync server, not the Mac. */
export function claudeNames(): typeof NAMES {
  const names = Object.fromEntries(Object.entries(NAMES).map(([id, n]) => [id, { name: tt(n.name), desc: tt(n.desc) }])) as typeof NAMES;
  return cloudSession() ? { ...names, claude: {
    name: tt('Claude (through your account)'),
    desc: tt('The best translations, and it can explain grammar. Goes through your account.'),
  } } : names;
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** `to`: the language translated into, for Chrome, whose models come one pair at a time (Chinese to French is its own). */
export function statusText(id: TranslatorId, a: Avail, claude?: ClaudeStatus | null, localOnly = false, to: string = DEFAULT_TARGET): { text: string; kind: 'ok' | 'warn' | 'off' } {
  if (id === 'claude' && localOnly) return { text: tt('Local only is on'), kind: 'off' };
  if ((id === 'mymemory' || id === 'account') && localOnly) return { text: tt('Local only is on'), kind: 'off' };
  // Both need the internet: offline they are not used up or missing a sign-in, only out of reach.
  if ((id === 'mymemory' || id === 'account') && offline() && a === 'no') return { text: tt('Offline'), kind: 'off' };
  if (a === 'yes') return { text: tt('Ready'), kind: 'ok' };
  if (a === 'download') return { text: tt('Download needed'), kind: 'warn' };
  if (id === 'claude') {
    const account = !!cloudSession();
    if (!hasClaudeRoute()) return { text: tt('Sign in or connect your Mac'), kind: 'off' };
    if (claude?.denied) return { text: account ? tt('Signed out') : tt('Mac refused this device'), kind: 'warn' };
    if (!claude?.reachable) return { text: account ? tt('Sync server not reachable') : tt('Mac not reachable'), kind: 'off' };
    if (claude.ownerOnly) return { text: tt('Only for the owner'), kind: 'off' };
    if (!claude.configured) return { text: account ? tt('No key on the sync server') : tt('No key on the Mac'), kind: 'warn' };
    if (claude.limitMessage) return { text: tt('Daily limit used'), kind: 'warn' };
    return { text: tt('Unavailable'), kind: 'off' };
  }
  if (id === 'chrome') return { text: chromeSupported() ? tt('Not available for {pair}', { pair: chromePairName(to) }) : tt('Not supported in this browser'), kind: 'off' };
  if (id === 'account') return cloudSession() ? { text: tt('Used up for today'), kind: 'warn' } : { text: tt('Sign in to use'), kind: 'off' };
  return { text: tt('Unavailable'), kind: 'off' };
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


/** A language translated into, by its name in the app's language (Chinese is simplified unless it says traditional). */
const targetName = (code: string, english: string) => langName(code === 'zh' ? 'zh-Hans' : code, english);

/**
 * The "Translate into" control: every listed language but the book's own, the library's default first (English, or Chinese in
 * the English library) and the rest by name. When the reader chose the book's own language (Spanish picked while reading
 * Chinese, now in the Spanish library), these books go into the default and the note says why.
 */
export function targetControl(settings: AppContext['settings']): { el: HTMLElement; id: string; update(s: Settings): void } {
  const id = nextId('into');
  const def = targetFor(undefined, langId());
  const all = targetsFor(langId());
  // Each by its name in the app's language, then its own name: "Spanish · Español" in English, "Spanisch · Español" in German.
  const named = all.map((t) => ({ ...t, shown: targetName(t.code, t.name) }));
  const choices = [...named.filter((t) => t.code === def), ...named.filter((t) => t.code !== def).sort((a, b) => a.shown.localeCompare(b.shown, uiLocale()))];
  const select = h('select.select', { id, 'aria-label': tt('Translate into') },
    ...choices.map((t) => h('option', { value: t.code }, t.native.toLowerCase() === t.shown.toLowerCase() ? t.native : `${t.shown} · ${t.native}`))) as HTMLSelectElement;
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
      note.textContent = own ? tt('These books are in {book}, so they are translated into {target}. {own} is used for your other books.', {
        book: langName(lang().id, lang().name), target: targetName(to, targetLanguage(to)?.name ?? 'English'), own: targetName(own.code, own.name),
      }) : '';
    },
  };
}

type StatusLine = { label: string; value: string; kind: 'ok' | 'warn' | 'off' };

/** Today's use of Claude, and the day's limits when the server gives them. */
function usageLines(status: ClaudeStatus): StatusLine[] {
  const lines: StatusLine[] = [];
  if (status.usage) {
    const used = status.usage.requests;
    const vars = { input: num(status.usage.inputTokens), output: num(status.usage.outputTokens) };
    const value = status.limits
      ? ttn(used, '{n} request, {input} input and {output} output tokens of {maxRequests} requests and {maxInput} input tokens',
        '{n} requests, {input} input and {output} output tokens of {maxRequests} requests and {maxInput} input tokens',
        { ...vars, maxRequests: num(status.limits.requests), maxInput: num(status.limits.inputTokens) })
      : ttn(used, '{n} request, {input} input and {output} output tokens', '{n} requests, {input} input and {output} output tokens', vars);
    lines.push({ label: tt('Today'), value, kind: status.limitMessage ? 'warn' : 'ok' });
  }
  if (status.limitMessage) lines.push({ label: tt('Limit'), value: status.limitMessage, kind: 'warn' });
  return lines;
}

/** The lines under "Claude through your Mac": is the Mac there, is the key set up, how much was used today. */
export function claudeStatusLines(status: ClaudeStatus | null, connected: boolean, account = false): StatusLine[] {
  if (account) {
    // Signed in: Claude goes through the account's server, wherever this device is.
    if (!status) return [{ label: tt('Account'), value: tt('Checking…'), kind: 'off' }];
    if (status.denied) return [{ label: tt('Account'), value: tt('This device is signed out. Sign in again above.'), kind: 'warn' }];
    if (!status.reachable) return [{ label: tt('Account'), value: tt('The sync server did not answer. Check this device’s internet connection.'), kind: 'off' }];
    if (status.ownerOnly) return [{ label: 'Claude', value: status.problem ?? tt('Claude translation is only for the owner of this site.'), kind: 'off' }];
    const lines: StatusLine[] = [{ label: tt('Account'), value: tt('Claude goes through your account, wherever you are'), kind: 'ok' }];
    lines.push(status.configured
      ? { label: tt('Claude key'), value: tt('Set up on the sync server'), kind: 'ok' }
      : { label: tt('Claude key'), value: status.problem ?? tt('Not set up on the sync server'), kind: 'warn' });
    return [...lines, ...usageLines(status)];
  }
  if (!connected) return [{ label: 'Mac', value: tt('This device is not connected to a Mac. Sign in, or connect it below.'), kind: 'off' }];
  if (!status) return [{ label: 'Mac', value: tt('Checking…'), kind: 'off' }];
  if (status.denied) return [{ label: 'Mac', value: tt('It answered but did not accept this device. Sign in to Tailscale with the Mac owner\'s account.'), kind: 'warn' }];
  if (!status.reachable) return [{ label: 'Mac', value: tt('Not reachable. Keep it awake and connected to Tailscale.'), kind: 'off' }];
  const lines: StatusLine[] = [{ label: 'Mac', value: tt('Reachable'), kind: 'ok' }];
  lines.push(status.configured
    ? { label: tt('Claude key'), value: status.warning ? tt('Set up on the Mac. {warning}', { warning: status.warning }) : tt('Set up on the Mac'), kind: status.warning ? 'warn' : 'ok' }
    : { label: tt('Claude key'), value: status.problem ?? tt('Not set up on the Mac'), kind: 'warn' });
  return [...lines, ...usageLines(status)];
}

/**
 * What Automatic tries, in order: Claude (through the account or the Mac) where this device has it, the model on the Mac where
 * there is one, Qwen, the browser's translator and the gloss. Each order is its own sentence, so a language can word it whole.
 */
function autoOrder(claude: boolean, mac: boolean, account: boolean): string {
  if (account) {
    if (claude && mac) return tt('Tries Claude through your account, then the model on your Mac, then Qwen through your account, then the browser’s translator, and last the word-by-word gloss.');
    if (claude) return tt('Tries Claude through your account, then Qwen through your account, then the browser’s translator, and last the word-by-word gloss.');
    if (mac) return tt('Tries the model on your Mac, then Qwen through your account, then the browser’s translator, and last the word-by-word gloss.');
    return tt('Tries Qwen through your account, then the browser’s translator, and last the word-by-word gloss.');
  }
  if (claude && mac) return tt('Tries Claude through your Mac, then the model on your Mac, then Qwen when you are signed in, then the browser’s translator, and last the word-by-word gloss.');
  if (claude) return tt('Tries Claude through your Mac, then Qwen when you are signed in, then the browser’s translator, and last the word-by-word gloss.');
  if (mac) return tt('Tries the model on your Mac, then Qwen when you are signed in, then the browser’s translator, and last the word-by-word gloss.');
  return tt('Tries Qwen when you are signed in, then the browser’s translator, and last the word-by-word gloss.');
}

export function translationGroup(ctx: AppContext, lookupRows: (Node | null)[] = [], open = false): { el: HTMLElement; update(s: Settings): void; dispose(): void } {
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
  const list = h('div.set-prov-list', { role: 'radiogroup', 'aria-label': tt('Translation provider') },
    rowEl('auto', tt('Automatic'), ''),
    ...ids.map((id) => rowEl(id, tt(NAMES[id].name), tt(NAMES[id].desc))));

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
  const dlBtn = h('button.btn.btn-sm', { type: 'button' }, icon('download'), tt('Download model')) as HTMLButtonElement;
  dlBtn.hidden = true;
  dlBtn.addEventListener('click', async () => {
    dlBtn.disabled = true;
    dlNote.textContent = '';
    try {
      await (getTranslator('chrome', settings.get(), ctx.dictSync()) as ChromeTranslator).prepare((f) => {
        dlBtn.lastChild!.textContent = tt('Downloading {percent}%', { percent: num(Math.round(f * 100)) });
      });
      dlNote.textContent = tt('The model is ready.');
    } catch (e) {
      dlNote.textContent = e instanceof Error ? e.message : tt('The download failed. Try again.');
    }
    dlBtn.lastChild!.textContent = tt('Download model');
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
    paintChip('auto', tt('Using {name}', { name: claudeNames()[pick].name }), 'ok');
    dlBtn.hidden = avail.chrome !== 'download';
    paintStatus();
    paintNames();
  }

  const modelId = nextId('model');
  const model = h('select.select', { id: modelId, 'aria-label': tt('Claude model') }, ...CLAUDE_MODELS.map((m) => h('option', { value: m.value }, tt(m.label)))) as HTMLSelectElement;
  model.addEventListener('change', () => settings.set({ claudeModel: model.value }));

  const localOnly = toggle('localOnly', isMacOrigin() ? tt('Local only: keep every sentence on this Mac') : tt('Local only: keep every sentence on this device'),
    (v) => settings.set({ localOnly: v }));

  const testOut = h('div.set-test-out', { role: 'status', 'aria-live': 'polite' });
  const testBtn = h('button.btn.btn-sm', { type: 'button' }, tt('Test Claude')) as HTMLButtonElement;
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testOut.className = 'set-test-out';
    testOut.textContent = tt('Testing…');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30000);
    try {
      const out = await getTranslator('claude', settings.get(), ctx.dictSync()).translate({ text: '你好，世界。', mode: 'translate' }, { signal: ac.signal });
      testOut.className = 'set-test-out set-good';
      testOut.textContent = tt('Works. “你好，世界。” came back as “{reply}”', { reply: out.slice(0, 120) });
    } catch (e) {
      testOut.className = 'set-test-out set-bad';
      const aborted = (e as { name?: string })?.name === 'AbortError';
      testOut.textContent = aborted ? tt('Claude did not answer within 30 seconds.') : e instanceof Error ? e.message : tt('The test failed.');
    } finally {
      clearTimeout(timer);
      testBtn.disabled = settings.get().localOnly;
      void refresh(true);
    }
  });
  const refreshBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => void refresh(true) }, icon('refresh'), tt('Check again')) as HTMLButtonElement;

  const claudeTitle = h('div.set-claude-title');
  const claudeBox = h('div.set-claude', null,
    claudeTitle,
    row(tt('Model'), tt('Haiku costs less.'), h('div.set-model-row', null, model), modelId),
    row(tt('Status'), tt('There is a daily limit, so the bill stays small.'), h('div.set-status-wrap', null, statusBox, h('div.set-test', null, h('div.set-btn-row', null, refreshBtn, testBtn), testOut))));

  /**
   * The words and rows that depend on where this device is and who is signed in: Claude through the account or the Mac, and
   * which providers there are at all. Painted at mount and again on signing in or out and on connecting a Mac.
   */
  function paintNames(): void {
    const names = claudeNames();
    const account = !!cloudSession();
    titles.get('claude')!.textContent = names.claude.name;
    descs.get('claude')!.textContent = names.claude.desc;
    claudeTitle.textContent = account ? tt('Claude through your account') : tt('Claude through your Mac');
    const claude = claudeHere();
    const mac = macHere();
    // A row stays while it is the reader's choice, so the choice is never hidden.
    const chosen = settings.get().translator;
    rowEls.get('claude')!.hidden = !claude && chosen !== 'claude';
    rowEls.get('local')!.hidden = !mac && chosen !== 'local';
    claudeBox.hidden = !claude;
    descs.get('auto')!.textContent = autoOrder(claude, mac, account);
  }

  const into = targetControl(settings);
  // Only the language shows at first. Which translator, Local only, Claude's model and how words are looked up (`lookupRows`,
  // from the settings screen) wait under "More settings": Automatic picks well for nearly everyone.
  const el = group(tt('Translation'), null,
    row(tt('Translate into'), tt('The language translations are written in.'), into, into.id),
    more('translation', [
      h('p.set-more-intro', null, tt('What translates a sentence when you tap a word twice or drag across it.')),
      h('div.set-prov-wrap', null, list),
      row(tt('Local only'), tt('Never send a sentence to an online translator.'), localOnly),
      claudeBox,
      ...lookupRows,
    ], open));

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
      descs.get('gloss')!.textContent = translateTarget(s) === DEFAULT_TARGET ? tt(NAMES.gloss.desc)
        : tt('Each word with its first dictionary meaning, in {language}. Works offline, but it is not a real translation.', { language: glossLanguage() });
      // Chrome's model, and so whether it is ready, depends on the language translated into.
      if (translateTarget(s) !== shownTarget) { shownTarget = translateTarget(s); void refresh(); }
      for (const [v, input] of radios) input.checked = s.translator === v;
      paintNames();
      localOnly.update(s);
      testBtn.disabled = s.localOnly;
      testBtn.title = s.localOnly ? tt('Local only is on, so Claude is not used.') : '';
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
