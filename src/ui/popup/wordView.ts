// The word popup's content: readings and definitions, character breakdown, single-character facts,
// stroke order, links, and the Save / Known / speak controls.
import type { AppContext, CharInfo, Dictionary, DictEntry, HskInfo } from '../../types';
import { formatSyllable, markedToNumbered, toneOf } from '../../core/pinyin';
import { isSaidDao } from '../../core/hskMatch';
import { speak, stopSpeaking, canSpeak } from '../../speech/tts';
import { qualityLocalAvailable, suggestMeaning } from '../../translate/localMeaning';
import { hasMacBridge } from '../../core/macBridge';
import { dictionaryContextMeaning } from '../../translate/contextSense';
import { h, clear } from '../dom';
import { icon } from '../icons';
import {
  codePointLabel, groupByReading, leadGloss, orderGroups, parseDefinition, plainDefinition, shortGloss, splitClassifiers, sameReading,
  withNodes, type Classifier, type ReadingGroup,
} from './defs';
import type { PopupHost } from './host';
import { addWordControl, bookCard, type BookCardEnv } from './bookCard';
import { mountFixView } from './fixView';
import { fixedWord } from '../../core/fixes';
import { createStrokeOrder } from './writer';
import { pinyinSpans } from './pinyinText';
import { properGroups } from '../../core/names';
import type { WordPopupOptions } from './popup';
import { entriesForReading } from '../../core/reading';
import { headwordsFor, vocabItemFor } from './saveWord';
import { flyToVocab } from '../fly';
import { popIcon } from '../vocab/motion';
import { cardMeanings, type CardMeanings } from './meanings';
import { tt, ttn } from '../../i18n';

interface View {
  word: string;
  prev?: string;
  next?: string;
  /** Numbered reading to list first (from a cross-reference). */
  reading?: string;
}

export interface WordView {
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

const ONE_CHAR = (s: string) => [...s].length === 1;

export { pinyinSpans };

const splitSyllables = (numbered: string) => numbered.split(/\s+/).filter(Boolean);

export function mountWordView(
  host: PopupHost,
  o: WordPopupOptions,
  dict: Dictionary,
  openPhrase: (text: string, anchor: DOMRect, context?: string) => void,
): WordView {
  const { ctx } = o;
  const store = ctx.store;
  const stack: View[] = [{ word: o.word, prev: o.prev, next: o.next, reading: o.reading?.join(' ') }];
  const refreshers: (() => void)[] = [];
  let speaking = false;
  let meaningCtl: AbortController | null = null;
  /** The meanings of the view on screen in the reader's language (meanings.ts), made with it. */
  let meanings: CardMeanings | null = null;

  const top = () => stack[stack.length - 1];
  const push = (v: View) => { stack.push(v); show(); };
  const back = () => {
    if (stack.length > 1) { stack.pop(); show(); } else o.onBack?.();
  };

  // ---- helpers over the dictionary

  const entriesFor = (word: string): DictEntry[] => dict.lookup(word);

  /** The book's own entry for a word (names and terms the dictionary lacks), when the reader passed a lexicon. */
  const bookEntry = (word: string) => {
    const lex = o.bookId ? o.lexicon : undefined;
    // The book may be shown in the other script than the one the entry was saved in.
    // A word joined at one place only is not among them, but its card still shows what the reader said it is.
    return lex && (lex.get(word) ?? lex.get(dict.toSimplified(word)) ?? lex.get(dict.toTraditional(word))
      ?? fixedWord(lex, word) ?? fixedWord(lex, dict.toSimplified(word)) ?? fixedWord(lex, dict.toTraditional(word)));
  };
  const cardEnv = (): BookCardEnv | null => o.bookId
    ? { ctx, bookId: o.bookId, lexicon: o.lexicon, onLexiconChange: o.onLexiconChange, close: () => host.close(), reposition: () => host.reposition(), fixer: o.fix?.fixer }
    : null;

  function contextSyllables(v: View): string[] {
    if (v.reading) {
      const shown = splitSyllables(v.reading);
      if (shown.length === [...v.word].length) return shown;
    }
    const own = bookEntry(v.word);
    if (own?.pinyin) {
      const given = splitSyllables(own.pinyin);
      if (given.length === [...v.word].length) return given;
    }
    const arr = dict.pinyinFor(v.word, { prev: v.prev, next: v.next });
    if (arr.some(Boolean)) return arr;
    if (ONE_CHAR(v.word)) {
      const r = dict.char(v.word)?.readings[0];
      if (r) return [markedToNumbered(r)];
    }
    return [];
  }

  /** The sense of a character that fits the reading beside it, never a surname, abbreviation or variant pointer. */
  function firstGloss(ch: string, syl = ''): string {
    const lead = leadGloss(entriesForReading(entriesFor(ch), [syl], ch), ch);
    if (lead) return lead;
    const info = dict.char(ch);
    return info?.definition.split(';')[0].trim() ?? '';
  }

  /** The neighbors a sense can depend on (the 里 after a number is a distance), only for a word opened from the page. */
  const aroundOf = (v: View) => (v.prev || v.next ? { prev: v.prev, next: v.next } : undefined);

  // ---- small builders

  const glyphLink = (ch: string, v?: Partial<View>) =>
    h('button.pp-glyph-link.zh', { onclick: () => push({ word: ch, ...v }), title: tt('Look up {word}', { word: ch }) }, ch);

  const refLink = (simp: string, pinyin: string) =>
    h('button.pp-xref', { onclick: () => push({ word: simp, reading: pinyin.toLowerCase() }) },
      h('span.zh', null, simp), ' ', h('span.pp-xref-py', null, pinyinText(pinyin)));

  const pinyinText = (numbered: string) => splitSyllables(numbered).map((s) => formatSyllable(s.toLowerCase(), ctx.settings.get().pinyinStyle)).join(' ');

  /**
   * The HSK chip: the level the list gives the word in the reading on screen. None on a name or place of this book (a person
   * called 高明 is not the HSK word 高明), or on 道 "said" (the list's 道 is the measure word of 一道题). When the list has the
   * word only in other readings, a muted hint says which (教 jiào: "HSK 1 as jiāo"), the reading a learner knows it by.
   */
  function hskChipFor(hsk: HskInfo | null, simp: string, syllables: string[], v: View, kind?: string): HTMLElement | null {
    if (!hsk || kind === 'name' || kind === 'place' || isSaidDao(simp, syllables, v.prev, v.next)) return null;
    const band = (n: number) => (n >= 7 ? '7-9' : String(n));
    if (hsk.hsk3) {
      const easiest = dict.hsk(simp)?.hsk3;
      const also = easiest && easiest < hsk.hsk3 ? band(easiest) : '';
      // Each note alone, or both as one string, so a language words them together its own way.
      const note = hsk.of && also ? tt('On the HSK list as {word}. Also HSK {level} in another reading', { word: hsk.of, level: also })
        : hsk.of ? tt('On the HSK list as {word}', { word: hsk.of })
        : also ? tt('Also HSK {level} in another reading', { level: also }) : null;
      return h('span.chip', { title: note }, tt('HSK {level}', { level: band(hsk.hsk3) }));
    }
    const other = hsk.elsewhere?.[0];
    if (!other) return null;
    const style = ctx.settings.get().pinyinStyle;
    const said = other.pinyin.map((s) => formatSyllable(s.toLowerCase(), style)).join(style === 'zhuyin' ? ' ' : '');
    return h('span.chip.pp-hsk-other', { title: tt('The HSK list has {word} as {reading} (level {level}), not in this reading', { word: simp, reading: said, level: band(other.hsk3) }) },
      tt('HSK {level} as {reading}', { level: band(other.hsk3), reading: said }));
  }

  /** A sense as the dictionary has it (its cross-references a tap away), and as plain text for the reader's language. */
  function renderDef(def: string, m: CardMeanings, shown: boolean): HTMLElement {
    const src = h('span.pp-def-src');
    for (const part of parseDefinition(def)) {
      if (part.t === 'text') src.appendChild(document.createTextNode(part.s));
      else src.appendChild(refLink(part.simp, part.pinyin));
    }
    const li = h('li', null, src);
    m.sense(li, plainDefinition(def), shown);
    return li;
  }

  function classifierLine(cls: Classifier[]): HTMLElement {
    const line = h('p.pp-cl', null, h('span.pp-cl-label', null, tt('Measure word')));
    cls.forEach((c, i) => {
      if (i > 0) line.appendChild(document.createTextNode(','));
      line.append(' ', refLink(c.simp, c.pinyin));
    });
    return line;
  }

  /** Definitions beyond this many sit behind a "more" button. */
  const DEF_LIMIT = 4;

  function readingBlock(g: ReadingGroup, headTrad: string, inSentence: boolean, showPinyin: boolean, m: CardMeanings): HTMLElement {
    const { rest, classifiers } = splitClassifiers(g.defs);
    const block = h('section.pp-reading');
    // The reading in this sentence is already the line under the headword; saying it again just adds height.
    if (showPinyin || inSentence) {
      const head = h('div.pp-reading-head');
      if (showPinyin) head.appendChild(pinyinSpans(ctx, splitSyllables(g.pinyin)));
      if (g.trad !== headTrad && g.trad !== g.simp) head.appendChild(h('span.pp-reading-trad.zh', null, g.trad));
      if (inSentence) head.appendChild(h('span.chip.chip-accent', null, tt('reading in this sentence')));
      block.appendChild(head);
    }
    if (rest.length) {
      const items = rest.map((d, i) => renderDef(d, m, i < DEF_LIMIT));
      const list = h('ol.pp-defs', null, items.slice(0, DEF_LIMIT));
      block.appendChild(list);
      if (items.length > DEF_LIMIT) {
        const hidden = items.length - DEF_LIMIT;
        const more = h('button.pp-more-btn', { type: 'button', 'aria-expanded': 'false' }, ttn(hidden, '{n} more', '{n} more')) as HTMLButtonElement;
        more.addEventListener('click', () => {
          list.append(...items.slice(DEF_LIMIT));
          more.remove();
          m.reveal(items.slice(DEF_LIMIT));
          host.reposition();
        });
        block.appendChild(more);
      }
    }
    if (classifiers.length) block.appendChild(classifierLine(classifiers));
    return block;
  }

  /** One character of a word as a compact chip: glyph, its reading, a few words of meaning. Opens the character. */
  function charCard(ch: string, syl: string, v: View): HTMLElement {
    const gloss = firstGloss(ch, syl);
    return h('button.pp-card', { onclick: () => push(v), title: tt('Look up {word}', { word: ch }) },
      h('span.pp-card-glyph.zh', null, ch),
      syl ? pinyinSpans(ctx, [syl]) : h('span.pp-py'),
      h('span.pp-card-gloss', null, gloss || tt('No definition')),
    );
  }

  function facts(info: CharInfo, v: View): HTMLElement {
    const rows: [string, Node | string][] = [];
    if (info.radical) {
      const r = info.radical;
      const shown = r.radicalChar || r.char;
      const strokes = r.residual;
      // The radical as written in the facts is an element (Chinese type); {radical} marks where it goes in the sentence.
      const said = r.char && r.char !== shown
        ? ttn(strokes, '{radical} ({char}), no. {num}, plus {n} stroke', '{radical} ({char}), no. {num}, plus {n} strokes', { char: r.char, num: r.num })
        : ttn(strokes, '{radical}, no. {num}, plus {n} stroke', '{radical}, no. {num}, plus {n} strokes', { num: r.num });
      rows.push([tt('Radical'), h('span', null, withNodes(said, { radical: h('span.zh', null, shown) }))]);
    }
    if (info.strokes !== null) rows.push([tt('Strokes'), String(info.strokes)]);
    const links = (label: string, chars: string[]) => {
      if (chars.length) rows.push([label, h('span.pp-glyphs', null, chars.map((c) => glyphLink(c, { prev: v.prev, next: v.next })))]);
    };
    links(tt('Simplified'), info.simplified);
    links(tt('Traditional'), info.traditional);
    links(tt('Variants'), info.variants);
    if (info.compatOf) rows.push([tt('Compatibility form of'), glyphLink(info.compatOf)]);
    // The code point is for a rare character (outside the everyday block, or one the dictionaries cannot read): something to
    // search with. An everyday character skips it.
    if (info.block !== 'CJK Unified Ideographs' || (!info.readings.length && !info.definition)) rows.push([tt('Code point'), `${codePointLabel(info.char)}, ${info.block}`]);
    const dl = h('dl.pp-facts');
    for (const [k, val] of rows) dl.append(h('dt', null, k), h('dd', null, val));
    return dl;
  }

  function sourceNote(info: CharInfo, hasCedict: boolean): HTMLElement | null {
    if (info.source === 'variant') {
      return h('p.pp-note', null, tt('This character has no entry of its own. The reading and meaning above come from a related character.'));
    }
    if (info.source === 'none' && !hasCedict) {
      return h('p.pp-note', null, tt('This rare character has no reading or meaning in the dictionary. The facts below and the links at the bottom may help.'));
    }
    if (hasCedict) return null;
    const from = info.source === 'wiktionary' ? 'Wiktionary' : info.source === 'cedict' ? 'CC-CEDICT' : 'Unihan';
    return h('p.pp-note', null, tt('Not in the CC-CEDICT word list. Reading and meaning from {source}.', { source: from }));
  }

  function links(word: string): HTMLElement {
    const w = encodeURIComponent(word);
    const a = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text, icon('external'));
    return h('nav.pp-links', { 'aria-label': tt('Other dictionaries') },
      a(`https://www.mdbg.net/chinese/dictionary?page=worddict&wdrst=0&wdqb=${w}`, 'MDBG'),
      a(`https://en.wiktionary.org/wiki/${w}`, 'Wiktionary'),
      a(`https://www.zdic.net/hans/${w}`, '汉典'),
    );
  }

  // ---- save / known

  /** The simplified and traditional spellings of a word for the reading on screen (see headwordsFor). */
  function headwords(v: View, entries: DictEntry[], syllables: string[] = contextSyllables(v)) {
    return headwordsFor(dict, v.word, entries, syllables);
  }

  async function toggleSave(v: View) {
    const entries = entriesFor(v.word);
    const { simp } = headwords(v, entries);
    const existing = (await store.vocab.get(simp)) ?? (await store.vocab.get(v.word));
    if (existing) {
      await store.vocab.remove(existing.id);
      return;
    }
    await store.vocab.put(vocabItemFor(dict, {
      word: v.word, syllables: contextSyllables(v), around: aroundOf(v), bookGloss: bookEntry(v.word)?.gloss, context: o.context,
    }));
    // Its star goes to Vocabulary in the top bar, where saved words wait (fly.ts; nothing where the bar is hidden, as in the reader).
    flyToVocab(host.content.querySelector('.pp-save'));
  }

  async function toggleKnown(v: View) {
    const { simp, trad } = headwords(v, entriesFor(v.word));
    if (store.known.has(v.word) || store.known.has(simp)) await store.known.remove([...new Set([simp, v.word, trad].filter(Boolean))]);
    else await store.known.add([simp]);
  }

  function playToggle(btn: HTMLElement, v: View) {
    if (speaking) { stopSpeaking(); speaking = false; btn.classList.remove('pp-on'); return; }
    speaking = true;
    btn.classList.add('pp-on');
    const s = ctx.settings.get();
    void speak(v.word, { rate: s.ttsRate, voice: s.ttsVoice, onError: message => ctx.toast(message) }).finally(() => { speaking = false; btn.classList.remove('pp-on'); });
  }

  // ---- the page

  function build(v: View): HTMLElement {
    const entries = entriesFor(v.word);
    const chars = [...v.word];
    const single = chars.length === 1;
    const info = single ? dict.char(v.word) : null;
    const syllables = contextSyllables(v);
    const { simp, trad, others, matched } = headwords(v, entries, syllables);
    // The level of this reading on the HSK list (行 háng is 3, not 行 xíng's 1).
    const hsk = dict.hsk(simp, syllables.length === [...simp].length ? syllables : undefined);
    const root = h('div.pp-word-view');

    // Header
    const saveBtn = h('button.icon-btn.pp-save', { onclick: () => void toggleSave(v), title: tt('Save word (S)'), 'aria-label': tt('Save word') });
    const knownBtn = h('button.icon-btn.pp-known', { onclick: () => void toggleKnown(v), title: tt('Mark as known (K)'), 'aria-label': tt('Mark as known') }, icon('checkCircle'));
    // What the buttons showed last, so a star or check that turns on gives one small pop (vocab/motion.ts) and any other change
    // leaves the icon alone; the first drawing has nothing to pop.
    let wasSaved: boolean | undefined;
    let wasKnown: boolean | undefined;
    const sync = () => {
      const saved = store.vocab.has(simp) || store.vocab.has(v.word);
      if (saved !== wasSaved) {
        saveBtn.replaceChildren(icon(saved ? 'starFill' : 'star'));
        if (saved && wasSaved === false) popIcon(saveBtn);
        wasSaved = saved;
      }
      saveBtn.setAttribute('aria-pressed', String(saved));
      saveBtn.title = saved ? tt('Remove from saved words (S)') : tt('Save word (S)');
      const known = store.known.has(simp) || store.known.has(v.word);
      // Learned from reading (settings.autoKnown) rather than marked by hand: said so, and the button looks a little lighter.
      const learned = known && (store.known.isAuto(simp) || store.known.isAuto(v.word));
      if (known && wasKnown === false) popIcon(knownBtn);
      wasKnown = known;
      knownBtn.setAttribute('aria-pressed', String(known));
      knownBtn.classList.toggle('pp-learned', learned);
      knownBtn.title = learned ? tt('Learned from reading. Click to unmark (K)') : known ? tt('Known. Click to unmark (K)') : tt('Mark as known (K)');
      knownBtn.setAttribute('aria-label', learned ? tt('Known, learned from reading') : tt('Mark as known'));
    };
    sync();
    refreshers.push(sync);

    const showBack = stack.length > 1 || !!o.onBack;
    const speakBtn = canSpeak()
      ? h('button.icon-btn.pp-speak', { onclick: (e: Event) => playToggle(e.currentTarget as HTMLElement, v), title: tt('Pronounce (P)'), 'aria-label': tt('Pronounce') }, icon('speaker'))
      : null;
    const closeBtn = h('button.icon-btn.pp-close', { onclick: () => host.close(), title: tt('Close (Esc)'), 'aria-label': tt('Close') }, icon('close'));
    // The pencil: fix how the page cuts or reads this word (the reader's word, at the root of the card).
    const target = o.fix?.target;
    const fixBtn = target && stack.length === 1 && /\p{Script=Han}/u.test(v.word)
      ? h('button.icon-btn.pp-fix-btn', { type: 'button', title: tt('Fix this word'), 'aria-label': tt('Fix this word'),
        onclick: () => mountFixView(host, ctx, dict, { fixer: o.fix!.fixer, target }, () => show()) }, icon('pen'))
      : null;
    // Translate sits beside Pronounce, Save and Known so it is found on a page of dense text, in a sheet or a card.
    const translateBtn = o.context?.sentence && stack.length === 1
      ? h('button.icon-btn.pp-translate', { type: 'button', title: tt('Translate sentence'), 'aria-label': tt('Translate sentence'),
        onclick: (e: Event) => openPhrase(o.context!.sentence, (e.currentTarget as HTMLElement).getBoundingClientRect(), o.context?.paragraph ?? o.context!.sentence) },
      icon('translate'))
      : null;

    // The headword is spelled the way the book spells it; the other script is the small one beside it.
    const otherForm = !single ? (v.word === simp ? (trad && trad !== simp ? trad : '') : (simp && simp !== v.word ? simp : '')) : '';
    root.appendChild(h('header.pp-head', null,
      showBack ? h('button.icon-btn.pp-back', { onclick: back, title: tt('Back'), 'aria-label': tt('Back') }, icon('arrowLeft')) : null,
      h('div.pp-title', null,
        h(`span.pp-word.zh${fixBtn && [...v.word].length === 3 ? '.pp-word-3' : fixBtn && [...v.word].length > 3 ? '.pp-word-4' : ''}`, null, v.word),
        otherForm ? h('span.pp-trad.zh', null, otherForm) : null,
      ),
      h('div.pp-head-actions', null, speakBtn, translateBtn, saveBtn, knownBtn, fixBtn, closeBtn),
    ));

    const pyLine = h('div.pp-pyline');
    // A name or place of this book is capitalized and grouped (Guō Jìng, Táohuā Dǎo); a technique or a plain word is not.
    const ownKind = bookEntry(v.word);
    // A proper noun of the dictionary (曹操, 王维, 北京) is written the same way: Cáo Cāo, Wáng Wéi, Běijīng.
    const proper = ownKind ? null : properGroups(entries, syllables);
    if (syllables.length) pyLine.appendChild(pinyinSpans(ctx, syllables, ownKind ? { kind: ownKind.kind, word: v.word } : proper ? { kind: 'name', word: v.word, groups: proper } : undefined));
    const hskChip = hskChipFor(hsk, simp, syllables, v, ownKind?.kind);
    if (hskChip) pyLine.appendChild(hskChip);
    if (single) {
      // Only the spellings that belong to the reading on screen: 了 (le) has none, 了 (liǎo) is also 瞭. A character that no
      // row of the dictionary has (a rare one) keeps what the character table says.
      const known = entries.length > 0;
      const toSimp = v.word !== simp;
      const forms = known ? (matched ? others : []) : (toSimp ? [simp] : info?.traditional.length ? info.traditional : info?.simplified ?? []);
      const label = known ? (toSimp ? tt('Simplified') : tt('Traditional')) : (toSimp || (!info?.traditional.length && info?.simplified.length) ? tt('Simplified') : tt('Traditional'));
      if (forms.length) pyLine.appendChild(h('span.pp-trad-note', null, label + ' ', h('span.zh', null, forms.join(' '))));
    }
    root.appendChild(pyLine);

    const body = h('div.pp-body');
    root.appendChild(body);

    // Names and terms of this book come first: the dictionary has nothing for them.
    const own = bookEntry(v.word);
    const env = cardEnv();
    if (own && env) body.appendChild(bookCard(env, own));

    const senses = entriesForReading(entries, syllables, v.word, aroundOf(v)).flatMap(e => splitClassifiers(e.defs).rest).map(plainDefinition).filter(Boolean);
    if (!senses.length && info?.definition) senses.push(...info.definition.split(/;\s*/).filter(Boolean));
    const hasTargetContext = !!o.context?.paragraph && [v.word, dict.toSimplified(v.word), dict.toTraditional(v.word)].some(w => o.context!.paragraph!.includes(w));
    const contextual = hasTargetContext && !own ? dictionaryContextMeaning(v.word, o.context!.paragraph!, senses) : null;
    // The dictionary meanings are what the card is for, so they come first. The context tools wait below them.
    const contextTools: HTMLElement[] = [];
    if (contextual) contextTools.push(h('section.pp-context', null,
      h('span.pp-section', null, tt('In this sentence')), h('strong', null, contextual.meaning), h('p.pp-muted', null, contextual.reason)));

    // A local model on the Mac can suggest a contextual sense, but the dictionary stays visible for checking it. It is offered
    // once the Mac answers with its model, so a device away from the Mac (Tailscale off, the Mac asleep) is not offered it.
    if (!contextual && hasTargetContext && o.context?.sentence && o.context.paragraph && hasMacBridge()) {
      if (senses.length) {
        const result = h('div.pp-context-result');
        const btn = h('button.btn.btn-sm', { type: 'button' }, icon('sparkle'), tt('Ask local AI about context')) as HTMLButtonElement;
        btn.addEventListener('click', async () => {
          meaningCtl?.abort();
          const ctl = (meaningCtl = new AbortController());
          btn.disabled = true;
          result.replaceChildren(h('span.app-spinner'), ' ' + tt('Checking with your Mac…'));
          host.reposition();
          try {
            const suggestion = await suggestMeaning(v.word, o.context!.sentence, o.context!.paragraph!, senses, ctl.signal);
            if (ctl.signal.aborted) return;
            result.replaceChildren(
              h('strong', null, suggestion.meaning),
              // The English rationale can invent subjects. Show the exact dictionary sense
              // and checked source quote, not a second, unverifiable AI paraphrase.
              ...(suggestion.evidence ? [h('p.pp-muted.zh', null, tt('Context clue: “{quote}”', { quote: suggestion.evidence }))] : []),
              h('p.pp-muted', null, suggestion.confidence === 'medium' ? tt('A guess by the AI. Check it against the passage.') : tt('Suggested by the AI, not taken from the dictionary.')),
            );
          } catch (e) {
            if (ctl.signal.aborted) return;
            result.textContent = e instanceof Error ? e.message : tt('The local model could not answer.');
            btn.disabled = false;
          }
          host.reposition();
        });
        // The suggestion carries its own "AI suggestion" line once there is one; nothing is said before that.
        const section = h('section.pp-context', { hidden: true }, h('span.pp-section', null, tt('Context')), btn, result);
        contextTools.push(section);
        void qualityLocalAvailable().then((ok) => { if (ok && section.isConnected) { section.hidden = false; host.reposition(); } });
      }
    }

    // Definitions per reading, then (for a reader whose language is not English) the line that puts them into it.
    const m = (meanings = cardMeanings(ctx, () => host.reposition()));
    if (entries.length) {
      const ordered = orderGroups(groupByReading(entriesForReading(entries, syllables, v.word, aroundOf(v))), v.reading ? splitSyllables(v.reading) : syllables);
      const hasContext = !!(o.context?.sentence || o.prev || o.next) && stack.length === 1;
      const flag = ordered.matched && hasContext && ordered.groups.some(g => !sameReading(g.pinyin, syllables));
      const ambiguous = ordered.groups.length > 1 || ordered.groups.some((g) => splitClassifiers(g.defs).rest.length > 1);
      ordered.groups.forEach((g, i) => {
        // With one reading, the pinyin under the headword is that reading: do not print it a second time.
        const repeated = ordered.groups.length === 1 && sameReading(g.pinyin, syllables);
        body.appendChild(readingBlock(g, trad, flag && i === 0, !repeated, m));
      });
      if (m.el) body.appendChild(m.el);
      if (hasContext && !own && ambiguous) body.appendChild(h('p.pp-note.pp-note-quiet', null, tt('All the dictionary meanings, not just the one used here.')));
    } else if (info) {
      const note = sourceNote(info, false);
      if (info.readings.length || info.definition) {
        const sec = h('section.pp-reading', null);
        if (info.readings.length) {
          sec.appendChild(h('div.pp-reading-head', null, ...info.readings.map((r) => h('span.pp-py', null, h('span.pp-syl', { class: `tone-${toneOf(r)}` }, formatSyllable(markedToNumbered(r), ctx.settings.get().pinyinStyle))))));
        }
        if (info.definition) {
          sec.appendChild(h('ol.pp-defs', null, info.definition.split(/;\s*/).filter(Boolean).map((d) => {
            const li = h('li', null, h('span.pp-def-src', null, d));
            m.sense(li, d);
            return li;
          })));
        }
        body.appendChild(sec);
        if (m.el) body.appendChild(m.el);
      }
      if (note) body.appendChild(note);
    } else if (!single && !own) {
      body.appendChild(h('p.pp-note', null, tt('This combination is not in the dictionary as a word. Each character is shown below.')));
      const add = env ? addWordControl(env, { word: v.word, pinyin: contextSyllables(v).join(' ') }) : null;
      if (add) body.appendChild(add);
    }
    if (single && info && entries.length) {
      const note = sourceNote(info, true);
      if (note) body.appendChild(note);
    }

    // The definitions come first; the sentence actions and the AI context check follow them.
    const readingActions = h('div.pp-reading-actions');
    if (o.context?.sentence) {
      const sentence = o.context.sentence;
      readingActions.appendChild(h('button.btn.btn-sm', { type: 'button',
        onclick: (e: Event) => openPhrase(sentence, (e.currentTarget as HTMLElement).getBoundingClientRect(), o.context?.paragraph ?? sentence),
      }, icon('translate'), tt('Translate sentence')));
    }
    if (stack.length === 1 && o.onReadFromHere && canSpeak()) readingActions.appendChild(h('span.pp-read-from', null,
      h('button.btn.btn-sm', { type: 'button', title: tt('Start at this word and continue to the end of the chapter'),
        onclick: () => { host.close(); o.onReadFromHere!(); } }, icon('play'), tt('Read from here'))));
    if (readingActions.childElementCount) body.appendChild(readingActions);
    body.append(...contextTools);

    // Character breakdown (multi-character words)
    if (!single) {
      const cards = h('div.pp-cards');
      const codePoints = chars;
      // The characters carry the reading shown above (a name's own reading: 华筝 huà zhēng, 靖儿 jìng ér), not a fresh guess.
      const py = syllables.length === chars.length && syllables.every(Boolean) ? syllables : dict.pinyinFor(v.word, { prev: v.prev, next: v.next });
      codePoints.forEach((ch, i) => {
        const syl = py[i] || (dict.char(ch)?.readings[0] ? markedToNumbered(dict.char(ch)!.readings[0]) : '');
        cards.appendChild(charCard(ch, syl, { word: ch, prev: i > 0 ? codePoints[i - 1] : v.prev, next: i < codePoints.length - 1 ? codePoints[i + 1] : v.next }));
      });
      body.appendChild(h('section.pp-chars', null, h('span.pp-section', null, tt('Characters')), cards));
    }

    // Single-character facts and stroke order
    if (single && info) {
      body.appendChild(h('section.pp-char-facts', null, h('span.pp-section', null, tt('Character')), facts(info, v)));
      body.appendChild(createStrokeOrder(v.word, () => host.reposition()));
    }

    body.appendChild(links(v.word));

    // Footer: stepping and resizing the selection (reader only). Sticky, so it is never clipped or scrolled away.
    const foot = h('footer.pp-foot');
    const atRoot = stack.length === 1;
    if (atRoot && (o.onStep || o.onResize)) {
      const seg = (label: string, title: string, run: () => void, lead: Node | null, trail: Node | null) =>
        h('button.pp-seg-btn', { type: 'button', onclick: run, title }, lead, h('span', null, label), trail);
      const tools = h('div.pp-tools.pp-seg', { role: 'group', 'aria-label': tt('Move or resize the selection') });
      if (o.onStep) {
        tools.append(
          seg(tt('Prev'), tt('Previous word (Left arrow)'), () => o.onStep!(-1), icon('chevronLeft'), null),
          seg(tt('Next'), tt('Next word (Right arrow)'), () => o.onStep!(1), null, icon('chevronRight')),
        );
      }
      if (o.onResize) {
        tools.append(
          seg(tt('Shorter'), tt('Shorter (Shift+Left)'), () => o.onResize!(-1), icon('minus'), null),
          seg(tt('Longer'), tt('Longer (Shift+Right)'), () => o.onResize!(1), icon('plus'), null),
        );
      }
      foot.appendChild(tools);
    }
    if (foot.childElementCount) root.appendChild(foot);
    return root;
  }

  function show() {
    meaningCtl?.abort();
    meaningCtl = null;
    meanings?.dispose();
    refreshers.length = 0;
    clear(host.content);
    host.content.appendChild(build(top()));
    meanings?.start();
    host.scroller.scrollTop = 0;
    // A view that replaced the element holding focus (drilling in, Back) keeps focus inside the dialog.
    if (!host.el.contains(document.activeElement)) host.focus();
    host.placeNow();
  }

  // Saved/known changes (from this popup, another tab, or the vocab screen) update the buttons in place.
  const off = store.onChange(() => refreshers.forEach((f) => f()));

  show();
  return {
    onKey(e) {
      const atRoot = stack.length === 1;
      const k = e.key;
      if (atRoot && o.onStep && (k === 'ArrowLeft' || k === 'ArrowRight') && !e.shiftKey) { o.onStep(k === 'ArrowLeft' ? -1 : 1); return true; }
      if (atRoot && o.onResize && (k === 'ArrowLeft' || k === 'ArrowRight') && e.shiftKey) { o.onResize(k === 'ArrowLeft' ? -1 : 1); return true; }
      if (k === 's' || k === 'S') { void toggleSave(top()); return true; }
      if (k === 'k' || k === 'K') { void toggleKnown(top()); return true; }
      if ((k === 'p' || k === 'P') && canSpeak()) { playToggle(host.content.querySelector('.pp-speak') ?? document.body, top()); return true; }
      if (k === 'Backspace' && stack.length > 1) { back(); return true; }
      return false;
    },
    dispose() {
      meaningCtl?.abort();
      meanings?.dispose();
      off();
      if (speaking) stopSpeaking();
    },
  };
}
