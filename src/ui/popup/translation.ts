// A translation block: picks a provider, streams the result, and offers Explain, a provider switcher,
// retry, and the one-time on-device model download. Used by the phrase popup and paragraph translate.
import type { AppContext, Dictionary, Lexicon, Translator, TranslatorId } from '../../types';
import { getTranslator, listTranslators, pickTranslator, type ChromeTranslator } from '../../translate';
import { claudeReadySync } from '../../translate/claude';
import type { TranslateOptions, TranslationNote } from '../../translate/prompt';
import { h, clear } from '../dom';
import { icon } from '../icons';
import { formatSyllable } from '../../core/pinyin';
import { segment } from '../../core/segment';
import { entriesForReading } from '../../core/reading';

export interface TranslationPanelOptions {
  ctx: AppContext;
  text: string;
  /** Surrounding paragraph, passed to the provider as reference. */
  context?: string;
  lexicon?: Lexicon;
  /** Called when the content height may have changed. */
  onResize?: () => void;
  /**
   * The caller lists the words of the text itself (the phrase popup does). An offline word-by-word gloss would
   * then only repeat that list, so the panel says plainly that there is no translation instead.
   */
  hasWordList?: boolean;
}

export interface TranslationPanel {
  el: HTMLElement;
  /** Cancels any request in flight. */
  destroy(): void;
}

/** Dictionary senses marked as older or regional usage: the ones a modern default most often gets wrong in an old book. */
const TAGGED_SENSE = /^\((?:archaic|dialect|literary|storytelling|old|dated|Wu dialect|Cantonese)\b/i;

/**
 * Match the displayed script, and keep the prompt's name glossary bounded. With `tagged`, words the dictionary marks as
 * archaic, literary, storytelling or dialect (却说, 只见, 恁地, 洒家, 俺) are included with those senses, whatever their frequency.
 */
export function translationTerms(text: string, lexicon?: Lexicon, dict?: Dictionary | null, options: { tagged?: boolean } = {}) {
  const seen = new Set<string>();
  const terms = (lexicon?.entries() || []).flatMap(entry => {
    const variants = [...new Set([entry.word, dict?.toSimplified(entry.word) || entry.word, dict?.toTraditional(entry.word) || entry.word])];
    return variants.filter(word => text.includes(word) && !seen.has(word)).map(word => {
      seen.add(word);
      return { word, pinyin: entry.pinyin.slice(0, 80), gloss: entry.gloss.slice(0, 160),
        kind: (entry.kind === 'name' || entry.kind === 'place' || /^name\b/i.test(entry.gloss) ? 'name' : 'term') as 'name' | 'term' | 'idiom' };
    });
  }).slice(0, 12);
  // Rare compounds and idioms are where generic translation most often invents a meaning or reading.
  // Send unambiguous dictionary entries as reference, without treating ordinary first senses as context facts.
  if (dict) {
    const candidates = [];
    for (const token of segment(text.slice(0, 6000), dict, lexicon)) {
      if (token.kind === 'han' && token.inDict) {
        const word = token.text;
        if (seen.has(word)) continue;
        const entries = dict.lookup(word);
        // Only a word whose leading sense is the older usage (not 备 or 座, which merely have a rare tagged sense).
        const lead = options.tagged && !([...word].length === 1 && dict.hsk(dict.toSimplified(word))) ? entriesForReading(entries, token.pinyin ?? []).filter(entry => TAGGED_SENSE.test(entry.defs[0] ?? '')) : [];
        const taggedSenses = [...new Set(lead.flatMap(entry => entry.defs.filter(def => TAGGED_SENSE.test(def))))];
        if (taggedSenses.length) {
          seen.add(word);
          candidates.push({ word, pinyin: entries[0].pinyin.slice(0, 80), gloss: taggedSenses.slice(0, 2).join('; ').slice(0, 160), kind: 'term' as const, rank: -0.5 });
          continue;
        }
        if ([...word].length < 2 || entries.length !== 1) continue;
        const entry = entries[0];
        // Capitalized pinyin marks a proper noun (千山 is a district in Liaoning, not "a thousand mountains"); names come from the book's lexicon.
        if (/^[A-Z]/.test(entry.pinyin)) continue;
        const idiom = entry.defs.some(def => /\bidiom\b/.test(def));
        const frequency = dict.freq(word);
        if (!idiom && (dict.hsk(word) || frequency > 20)) continue;
        seen.add(word);
        const figurative = idiom ? entry.defs.filter(def => /^fig\./.test(def)) : [];
        candidates.push({ word, pinyin: entry.pinyin.slice(0, 80), gloss: (figurative.length ? figurative : entry.defs.filter(def => !/^CL:/.test(def))).join('; ').slice(0, 160),
          kind: idiom ? 'idiom' as const : 'term' as const, rank: idiom ? -1 : frequency });
      }
    }
    terms.push(...candidates.sort((a, b) => a.rank - b.rank || b.word.length - a.word.length).slice(0, 12 - terms.length)
      .map(({ word, pinyin, gloss, kind }) => ({ word, pinyin, gloss, kind })));
  }
  return terms;
}

const NOTES: Record<TranslatorId, { no: string; yes: string }> = {
  local: { no: 'Keep your Mac awake with Ollama and the private connection running', yes: 'Processed on your Mac; no cloud translation service' },
  chrome: { no: 'Not available in this browser', yes: 'On this device' },
  claude: { no: 'Needs your Mac with a Claude key on it', yes: 'Through your Mac' },
  mymemory: { no: 'Not available', yes: 'Sends the text to MyMemory' },
  gloss: { no: 'Not available', yes: 'Offline, word by word' },
};

/** Tiny safe formatter for model output: paragraphs, "- " bullets and **bold**. No HTML is ever parsed. */
export function renderRichText(text: string): HTMLElement {
  const root = h('div.pp-rich');
  let list: HTMLUListElement | null = null;
  const newList = () => h('ul.pp-rich-list') as HTMLUListElement;
  const inline = (parent: HTMLElement, s: string) => {
    s.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) parent.appendChild(h('strong', null, part.slice(2, -2)));
      else if (part) parent.appendChild(document.createTextNode(part));
    });
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { list = null; continue; }
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) { list = newList(); root.appendChild(list); }
      const li = h('li');
      inline(li, bullet[1]);
      list.appendChild(li);
    } else {
      list = null;
      const p = h('p');
      inline(p, line.replace(/^#+\s*/, ''));
      root.appendChild(p);
    }
  }
  return root;
}

export function createTranslationPanel(o: TranslationPanelOptions): TranslationPanel {
  const { ctx } = o;
  const label = h('span.pp-tr-provider');
  const body = h('div.pp-tr-body', { 'aria-live': 'polite', 'aria-atomic': 'false', 'aria-busy': 'false' });
  const actions = h('div.pp-tr-actions');
  const menuHost = h('div.pp-tr-menuhost');
  const el = h('section.pp-tr', null,
    h('div.pp-tr-head', null, h('span.pp-section', null, 'Translation'), label),
    body, actions, menuHost);

  let abort: AbortController | null = null;
  let seq = 0;
  let current: Translator | null = null;
  let lastMode: 'translate' | 'explain' = 'translate';
  let destroyed = false;
  let busy = false;
  /** Screen readers wait for the whole answer while it streams (aria-busy), then read it once. */
  const setBusy = (b: boolean) => { busy = b; body.setAttribute('aria-busy', String(b)); };
  let resultText = '';
  let localReady = false;
  let plainResult: { text: string; provider: Translator } | null = null;
  let retryAction: (() => void) | null = null;
  const changed = () => { if (!destroyed) o.onResize?.(); };

  const setLabel = (t: Translator | null) => { label.textContent = t ? t.label : ''; };

  function appendReferences(t: Translator): void {
    if (t.id === 'gloss') {
      body.appendChild(h('p.pp-tr-note', null, 'This is a dictionary gloss, not a context-aware translation. Its first meanings may be wrong here. Try another provider for a full sentence translation.'));
      return;
    }
    body.appendChild(h('p.pp-tr-note', null, 'Machine translation: check ambiguous literary meanings and rare terms against the references.'));
    const references = translationTerms(o.text, o.lexicon, ctx.dictSync(), { tagged: true });
    if (!references.length) return;
    const list = h('dl.pp-tr-references');
    for (const term of references) list.append(
      h('dt', null, h('span.zh', null, term.word), ' · ', term.pinyin.split(/\s+/).map(s => formatSyllable(s.toLowerCase(), ctx.settings.get().pinyinStyle)).join(' ')),
      h('dd', null, term.gloss));
    body.appendChild(h('details.pp-tr-reference-box', null, h('summary', null, 'Check reference terms'), list));
  }

  const showError = (message: string, retry: (() => void) | null, extra?: Node) => {
    setBusy(false);
    resultText = '';
    clear(body);
    body.appendChild(h('p.pp-tr-error', null, message));
    if (extra) body.appendChild(extra);
    renderActions(retry);
    changed();
  };

  async function run(id: TranslatorId | null, mode: 'translate' | 'explain'): Promise<void> {
    if (destroyed) return;
    abort?.abort();
    const mine = ++seq;
    const ctl = (abort = new AbortController());
    lastMode = mode;
    el.classList.remove('pp-tr-quiet');
    setBusy(true);
    resultText = '';
    clear(body);
    body.appendChild(h('div.pp-tr-loading', null, h('span.app-spinner'), mode === 'explain' ? 'Explaining…' : 'Translating…'));
    renderActions(null);
    menuHost.hidden = true;
    changed();

    const settings = ctx.settings.get();
    const dict = ctx.dictSync();
    let t: Translator;
    try {
      t = id ? getTranslator(id, settings, dict) : await pickTranslator(settings, dict);
    } catch (e) {
      if (mine === seq) showError((e as Error).message, () => void run(id, mode));
      return;
    }
    if (mine !== seq) return;
    current = t;
    setLabel(t);

    if (t.id === 'gloss' && o.hasWordList) { showNoTranslation(id === null && settings.translator === 'auto'); return; }

    let availability: 'yes' | 'download' | 'no';
    try { availability = await t.availability(); } catch { availability = 'no'; }
    if (mine !== seq) return;
    if (availability === 'no') {
      const note = NOTES[t.id].no;
      showError(`${t.label} is not available. ${note}.`, null);
      return;
    }
    if (availability === 'download') { showDownload(t as ChromeTranslator, mode, id === null, mine); return; }

    const text = h('div.pp-tr-text');
    clear(body);
    body.appendChild(text);
    const paint = (s: string) => {
      if (mine !== seq) return;
      resultText = s;
      if (mode === 'explain') { clear(text); text.appendChild(renderRichText(s)); } else text.textContent = s;
      changed();
    };
    let note: TranslationNote | null = null;
    try {
      const options: TranslateOptions = { signal: ctl.signal, onDelta: paint, onNote: n => { note = n; } };
      const final = await t.translate(
        { text: o.text, context: o.context, mode,
          terms: translationTerms(o.text, o.lexicon, dict, { tagged: true }) },
        options,
      );
      if (mine !== seq) return;
      paint(final);
      setBusy(false);
      if (mode === 'translate') plainResult = { text: final, provider: t };
      // The checks could not confirm every detail: say so plainly instead of presenting a confident answer.
      if (note) body.appendChild(h('p.pp-tr-note', { 'data-unverified': '' }, `Unverified: ${(note as TranslationNote).detail}. Check the reference words below.`));
      appendReferences(t);
      renderActions(null);
    } catch (e) {
      if (mine !== seq || (e as { name?: string }).name === 'AbortError') return;
      showError((e as Error).message || 'Translation failed.', () => void run(id, mode));
    }
  }

  /**
   * No real translator is reachable. The caller already lists every word with its meaning, so repeating those
   * glosses here as a "translation" would only say the same thing twice (with the same lead senses). One quiet line.
   */
  function showNoTranslation(automatic: boolean) {
    setBusy(false);
    resultText = '';
    el.classList.add('pp-tr-quiet');
    clear(body);
    const settings = h('a.pp-tr-link', { href: '#/settings' }, 'Settings');
    const noTranslator = typeof (globalThis as { Translator?: unknown }).Translator === 'undefined';
    if (automatic) {
      body.appendChild(h('p', null,
        'No translation offline. ',
        noTranslator ? 'Safari and iPadOS have no on-device translator. ' : '',
        'Add a Claude key in ', settings, ', or use Chrome on a computer.'));
    } else {
      body.appendChild(h('p', null, 'Translation is set to word by word, so the list below is the result. Choose another provider below or in ', settings, '.'));
    }
    renderActions(null);
    changed();
  }

  function showDownload(t: ChromeTranslator, mode: 'translate' | 'explain', withGloss: boolean, mine: number) {
    setBusy(false);
    clear(body);
    const status = h('span.pp-muted');
    const btn = h('button.btn.btn-primary.btn-sm', {
      onclick: async () => {
        btn.disabled = true;
        status.textContent = 'Downloading…';
        try {
          await t.prepare((f) => { status.textContent = `Downloading ${Math.round(f * 100)}%`; });
          void run('chrome', mode);
        } catch (e) {
          btn.disabled = false;
          status.textContent = (e as Error).message || 'Download failed.';
          changed();
        }
      },
    }, icon('download'), 'Download on-device translation') as HTMLButtonElement;
    body.append(
      h('p.pp-tr-note', null, 'Chrome can translate on this device without sending text anywhere. It needs a one-time model download.'),
      h('div.pp-tr-dl', null, btn, status),
    );
    renderActions(null);
    changed();
    if (!withGloss || o.hasWordList) return;
    // Until the model is downloaded, still give a word-by-word gloss so the popup is never empty.
    const gloss = getTranslator('gloss', ctx.settings.get(), ctx.dictSync());
    void gloss.translate({ text: o.text, mode: 'translate' }).then((g) => {
      if (mine !== seq || destroyed || !g) return;
      resultText = g;
      body.append(h('p.pp-tr-note', null, 'Word by word, in the meantime:'), h('div.pp-tr-text', null, g));
      renderActions(retryAction);
      changed();
    }, () => { /* the gloss is a bonus */ });
  }

  function renderActions(retry: (() => void) | null) {
    retryAction = retry;
    clear(actions);
    actions.hidden = false;
    const hasClaude = claudeReadySync(ctx.settings.get());
    if (busy) {
      actions.appendChild(h('button.btn.btn-sm', {
        'aria-label': lastMode === 'explain' ? 'Stop explanation' : 'Stop translation',
        onclick: () => {
          abort?.abort();
          seq++;
          setBusy(false);
          if (!resultText) clear(body);
          body.appendChild(h('p.pp-tr-note', null, 'Stopped.'));
          renderActions(() => void run(current?.id ?? null, lastMode));
          changed();
        },
      }, icon('stop'), 'Stop'));
    }
    if (retry) actions.appendChild(h('button.btn.btn-sm', { onclick: retry }, icon('refresh'), 'Try again'));
    if (!busy && (hasClaude || localReady || current?.id === 'local') && lastMode === 'translate') {
      actions.appendChild(h('button.btn.btn-sm', { onclick: () => void run(current?.id === 'local' || !hasClaude ? 'local' : 'claude', 'explain'), title: 'Translation plus notes on words and grammar' },
        icon('sparkle'), 'Explain'));
    }
    if (lastMode === 'explain') {
      actions.appendChild(h('button.btn.btn-sm', { onclick: () => {
        if (!plainResult) { void run(current?.id ?? null, 'translate'); return; }
        abort?.abort();
        seq++;
        setBusy(false);
        lastMode = 'translate';
        current = plainResult.provider;
        resultText = plainResult.text;
        setLabel(current);
        clear(body);
        body.appendChild(h('div.pp-tr-text', null, resultText));
        appendReferences(current);
        renderActions(null);
        changed();
      } }, 'Plain translation'));
    }
    if (!busy && resultText.trim()) actions.appendChild(h('button.btn.btn-sm', {
      onclick: async () => {
        try { await navigator.clipboard.writeText(resultText); ctx.toast('Translation copied'); }
        catch { ctx.toast('Select the translation and use Copy.'); }
      },
    }, icon('copy'), 'Copy translation'));
    actions.appendChild(h('button.btn.btn-sm.btn-ghost', { onclick: () => void toggleMenu(), 'aria-haspopup': 'menu' },
      'Try another provider', icon('chevronDown')));
  }

  async function toggleMenu() {
    if (!menuHost.hidden && menuHost.childElementCount) { menuHost.hidden = true; changed(); return; }
    clear(menuHost);
    menuHost.hidden = false;
    menuHost.appendChild(h('div.pp-muted', null, 'Checking…'));
    changed();
    const list = await listTranslators(ctx.settings.get(), ctx.dictSync());
    if (destroyed || menuHost.hidden) return;
    clear(menuHost);
    const menu = h('div.pp-menu', { role: 'menu' });
    for (const { translator, availability } of list) {
      const note = availability === 'no' ? NOTES[translator.id].no
        : availability === 'download' ? 'Needs a one-time download'
        : NOTES[translator.id].yes;
      const item = h('button.pp-menu-item', {
        role: 'menuitem',
        disabled: availability === 'no',
        onclick: () => { menuHost.hidden = true; void run(translator.id, 'translate'); },
      }, h('span.pp-menu-name', null, translator.label), h('span.pp-menu-note', null, note));
      if (translator.id === current?.id) item.setAttribute('aria-current', 'true');
      menu.appendChild(item);
    }
    menuHost.appendChild(menu);
    changed();
    // The list can be taller than what is left of the popup: bring it into view inside the popup's own scroll box.
    requestAnimationFrame(() => { if (!destroyed && typeof menu.scrollIntoView === 'function') menu.scrollIntoView({ block: 'nearest' }); });
  }

  void getTranslator('local', ctx.settings.get(), ctx.dictSync()).availability().then(availability => {
    if (destroyed) return;
    localReady = availability === 'yes';
    if (localReady) { renderActions(retryAction); changed(); }
  }, () => {});
  void run(null, 'translate');
  return {
    el,
    destroy() {
      destroyed = true;
      seq++;
      abort?.abort();
    },
  };
}
