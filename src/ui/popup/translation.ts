// A translation block: picks a provider, streams the result, and offers Explain, a provider switcher,
// retry, and the one-time on-device model download. Used by the phrase popup and paragraph translate.
import type { AppContext, Dictionary, Lexicon, Settings, Translator, TranslatorId } from '../../types';
import { chromeSupported, getTranslator, listTranslators, pickTranslator, type ChromeTranslator } from '../../translate';
import { chromePairName } from '../../translate/chrome';
import { DEFAULT_TARGET, targetFor, targetLanguage } from '../../translate/targets';
import { claudeReadySync } from '../../translate/claude';
import { cloudBase, cloudSession } from '../../core/cloud';
import type { TranslateOptions, TranslationNote } from '../../translate/prompt';
import { h, clear } from '../dom';
import { isChinese, langId } from '../../lang/active';
import type { LangId } from '../../lang/types';
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
const PERSON_NAME = new RegExp(String.raw`^([A-Z][a-z']+(?:[ -][A-Z]?[a-z']+){0,3})(?: \((?:c\. )?\d{0,4}(?: BC)?\s*[-–]|, (?:the |a |an )?(?:[\w-]+ ){0,4}(?:protagonist|antihero|hero|heroine|character|friend|wife|husband|son|daughter|mother|father|brother|sister|poet|writer|author|novelist|general|emperor|empress|king|queen|prince|princess|minister|official|scholar|philosopher|monk|painter|statesman|founder|warlord|concubine|maid|servant)\b)`);
const NOT_A_PERSON = /\b(?:Dynasty|War|Period|Kingdom|Empire|Republic|River|Mountains?|Lake|Province|County|District|City)\b/;
const squashName = (s: string) => s.toLowerCase().replace(/u:/g, 'u').replace(/ü/g, 'u').replace(/[\s'’\-]/g, '');

/** The English name a dictionary definition gives a person or a character ("Kong Yiji, protagonist of…", "Li Bai (701-762), …"), or null. */
export function personName(def: string): string | null {
  const m = PERSON_NAME.exec(def);
  return m && !NOT_A_PERSON.test(m[1]) ? m[1] : null;
}

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
        // A proper noun the dictionary describes as a person or a character (孔乙己, 林黛玉, 张飞) is a name the book's scan leaves
        // to the dictionary: it goes in, spelled as the dictionary spells it (a foreign one by its English name).
        const person = /^[A-Z]/.test(entry.pinyin) ? personName(entry.defs[0] ?? '') : null;
        if (person) {
          seen.add(word);
          const chinese = squashName(person) === squashName(entry.pinyin.replace(/[1-5]/g, ''));
          candidates.push({ word, pinyin: entry.pinyin.slice(0, 80), gloss: person, kind: chinese ? 'name' as const : 'term' as const, rank: -2 });
          continue;
        }
        // Any other proper noun stays out: a place or an era may be a plain phrase here (千山 is also "a thousand mountains").
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
  account: { no: 'Sign in, and turn off Local only', yes: 'Through your account' },
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
  // The language this panel translates into, for its whole life: a choice made in Settings meanwhile shows on the next one.
  const to = targetFor(ctx.settings.get().translateTo, langId());
  const into = to === DEFAULT_TARGET ? null : targetLanguage(to)!;
  /**
   * The settings this panel's translators are made from: the current ones, with the panel's language. Made from the current
   * ones alone, a choice of French made in another tab (or brought by sync) while an English panel is open gave Chrome French
   * (its pair, its availability) and left MyMemory and Claude in English, under one "Translation" header.
   */
  const settingsHere = (): Settings => ({ ...ctx.settings.get(), translateTo: to });
  /**
   * Why a translator cannot run, for the error and the provider menu. Chrome with a translator that lacks this pair names the
   * pair (Not available for Chinese to Filipino), so the reader picks another language or provider, not another browser.
   */
  const unavailable = (id: TranslatorId) => (id === 'chrome' && chromeSupported() ? `Not available for ${chromePairName(to)}` : NOTES[id].no);
  const label = h('span.pp-tr-provider');
  const section = h('span.pp-section', null, into ? `${into.name} translation` : 'Translation');
  const body = h('div.pp-tr-body', { 'aria-live': 'polite', 'aria-atomic': 'false', 'aria-busy': 'false' });
  const actions = h('div.pp-tr-actions');
  const menuHost = h('div.pp-tr-menuhost');
  const el = h('section.pp-tr', null,
    h('div.pp-tr-head', null, section, label),
    body, actions, menuHost);
  /**
   * Marks a translation's language, so it is read aloud and drawn as that language (Japanese kanji, Arabic right to left).
   * `code`: the language the answer is in, the panel's unless the server behind it answered in another (onInto).
   */
  const tagged = (node: HTMLElement, code: string = to): HTMLElement => {
    const t = code === DEFAULT_TARGET ? undefined : targetLanguage(code);
    if (t) { node.lang = t.code; if (t.rtl) node.dir = 'rtl'; else node.removeAttribute('dir'); }
    else { node.removeAttribute('lang'); node.removeAttribute('dir'); }
    return node;
  };

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
  let plainResult: { text: string; provider: Translator; into: string } | null = null;
  let retryAction: (() => void) | null = null;
  const changed = () => { if (!destroyed) o.onResize?.(); };

  const setLabel = (t: Translator | null, code: string = to) => {
    label.textContent = t ? t.label : '';
    // The gloss is English whatever the choice, so it is not called a Spanish translation.
    const lang = code === DEFAULT_TARGET ? undefined : targetLanguage(code);
    section.textContent = lang && t?.id !== 'gloss' ? `${lang.name} translation` : 'Translation';
  };

  function appendReferences(t: Translator): void {
    if (t.id === 'gloss') {
      // The dictionaries only give English, whatever language the reader translates into.
      body.appendChild(h('p.pp-tr-note', null, into ? 'A word-by-word gloss in English, not a real translation. The first meanings may be wrong here.'
        : 'A word-by-word gloss, not a real translation. The first meanings may be wrong here.'));
      return;
    }
    body.appendChild(h('p.pp-tr-note', null, 'Machine translation. Check rare or odd words against the list below.'));
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

    const settings = settingsHere();
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
      showError(`${t.label} is not available. ${unavailable(t.id)}.`, null);
      return;
    }
    if (availability === 'download') { showDownload(t as ChromeTranslator, mode, id === null, mine); return; }

    // The gloss is English whatever the choice; any other translator answers in the chosen language.
    const text = t.id === 'gloss' ? h('div.pp-tr-text') : tagged(h('div.pp-tr-text'));
    clear(body);
    body.appendChild(text);
    const paint = (s: string) => {
      if (mine !== seq) return;
      resultText = s;
      if (mode === 'explain') { clear(text); text.appendChild(renderRichText(s)); } else text.textContent = s;
      changed();
    };
    let note: TranslationNote | null = null;
    // The language the answer came back in: the panel's, unless a server from before the choice answered in English.
    let answered = to;
    try {
      const options: TranslateOptions = { signal: ctl.signal, onDelta: paint, onNote: n => { note = n; }, onInto: code => { answered = code; } };
      const final = await t.translate(
        { text: o.text, context: o.context, mode,
          terms: translationTerms(o.text, o.lexicon, dict, { tagged: true }),
          // Every translator learns the book's language here (a request without one is Chinese, as before languages), and
          // the language to translate into (a request without one is English, as before the choice).
          ...(isChinese() ? {} : { lang: langId() as Exclude<LangId, 'zh'> }), ...(into ? { to } : {}) },
        options,
      );
      if (mine !== seq) return;
      if (answered !== to) { tagged(text, answered); setLabel(t, answered); }
      paint(final);
      setBusy(false);
      if (mode === 'translate') plainResult = { text: final, provider: t, into: answered };
      if (into && answered !== to) {
        body.appendChild(h('p.pp-tr-note', { 'data-other-language': '' },
          `This answer is in ${targetLanguage(answered)?.name ?? 'English'}. The server that made it needs an update to translate into ${into.name}.`));
      }
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
    if (automatic && cloudBase() && !cloudSession() && !ctx.settings.get().localOnly) {
      const signIn = h('button.pp-tr-link', { type: 'button', onclick: () => void import('../signIn').then((m) => m.openSignIn()) }, 'Sign in');
      body.appendChild(h('p', null, signIn, ' to translate whole sentences. It’s free.'));
    } else if (automatic) {
      body.appendChild(h('p', null,
        'No sentence translator is available right now. ',
        noTranslator ? 'Safari and iPadOS have no on-device translator. ' : '',
        'See ', settings, '.'));
    } else {
      body.appendChild(h('p', null, 'Translation is set to word by word. Pick another below or in ', settings, '.'));
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
    const gloss = getTranslator('gloss', settingsHere(), ctx.dictSync());
    void gloss.translate({ text: o.text, mode: 'translate' }).then((g) => {
      if (mine !== seq || destroyed || !g) return;
      resultText = g;
      body.append(h('p.pp-tr-note', null, into ? 'Word by word in English, in the meantime:' : 'Word by word, in the meantime:'), h('div.pp-tr-text', null, g));
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
    // Explained by whichever model translated it (the Mac's, or Qwen through the account), else Claude, else the Mac's model.
    const explainer = current?.id === 'local' || current?.id === 'account' ? current.id : hasClaude ? 'claude' : 'local';
    if (!busy && (hasClaude || localReady || current?.id === 'local' || current?.id === 'account') && lastMode === 'translate') {
      actions.appendChild(h('button.btn.btn-sm', { onclick: () => void run(explainer, 'explain'), title: 'Translation plus notes on words and grammar' },
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
        setLabel(current, plainResult.into);
        clear(body);
        body.appendChild(current.id === 'gloss' ? h('div.pp-tr-text', null, resultText) : tagged(h('div.pp-tr-text', null, resultText), plainResult.into));
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
    const list = await listTranslators(settingsHere(), ctx.dictSync());
    if (destroyed || menuHost.hidden) return;
    clear(menuHost);
    const menu = h('div.pp-menu', { role: 'menu' });
    for (const { translator, availability } of list) {
      const note = availability === 'no' ? unavailable(translator.id)
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

  void getTranslator('local', settingsHere(), ctx.dictSync()).availability().then(availability => {
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
