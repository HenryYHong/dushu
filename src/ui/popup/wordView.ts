// The word popup's content: readings and definitions, character breakdown, single-character facts,
// stroke order, links, and the Save / Known / speak controls.
import type { AppContext, CharInfo, Dictionary, DictEntry, VocabItem } from '../../types';
import { formatSyllable, markedToNumbered, toneOf } from '../../core/pinyin';
import { newSrs } from '../../core/srs';
import { speak, stopSpeaking, canSpeak } from '../../speech/tts';
import { suggestMeaning } from '../../translate/localMeaning';
import { hasMacBridge } from '../../core/macBridge';
import { dictionaryContextMeaning } from '../../translate/contextSense';
import { h, clear } from '../dom';
import { icon } from '../icons';
import {
  codePointLabel, groupByReading, orderGroups, parseDefinition, plainDefinition, shortGloss, splitClassifiers, sameReading,
  type Classifier, type ReadingGroup,
} from './defs';
import type { PopupHost } from './host';
import { addWordControl, bookCard, type BookCardEnv } from './bookCard';
import { createStrokeOrder } from './writer';
import type { WordPopupOptions } from './popup';
import { entriesForReading } from '../../core/reading';

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

/** One syllable list as colored spans in the user's pinyin style. */
export function pinyinSpans(ctx: AppContext, syllables: string[]): HTMLElement {
  const { pinyinStyle, toneColors } = ctx.settings.get();
  const box = h('span.pp-py');
  syllables.filter(Boolean).forEach((s, i) => {
    const lower = s.toLowerCase();
    const span = h('span.pp-syl', null, formatSyllable(lower, pinyinStyle));
    if (toneColors) span.classList.add(`tone-${toneOf(lower)}`);
    if (i > 0) box.appendChild(document.createTextNode(' '));
    box.appendChild(span);
  });
  return box;
}

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
    return lex && (lex.get(word) ?? lex.get(dict.toSimplified(word)) ?? lex.get(dict.toTraditional(word)));
  };
  const cardEnv = (): BookCardEnv | null => o.bookId
    ? { ctx, bookId: o.bookId, lexicon: o.lexicon, onLexiconChange: o.onLexiconChange, close: () => host.close(), reposition: () => host.reposition() }
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

  function firstGloss(ch: string, syl = ''): string {
    const e = entriesForReading(entriesFor(ch), [syl]);
    for (const x of e) {
      const { rest } = splitClassifiers(x.defs);
      const d = rest.find((s) => !/^(variant of|old variant of|surname|see |also written)/i.test(s)) ?? rest[0];
      if (d) return plainDefinition(d);
    }
    const info = dict.char(ch);
    return info?.definition.split(';')[0].trim() ?? '';
  }

  // ---- small builders

  const glyphLink = (ch: string, v?: Partial<View>) =>
    h('button.pp-glyph-link.zh', { onclick: () => push({ word: ch, ...v }), title: `Look up ${ch}` }, ch);

  const refLink = (simp: string, pinyin: string) =>
    h('button.pp-xref', { onclick: () => push({ word: simp, reading: pinyin.toLowerCase() }) },
      h('span.zh', null, simp), ' ', h('span.pp-xref-py', null, pinyinText(pinyin)));

  const pinyinText = (numbered: string) => splitSyllables(numbered).map((s) => formatSyllable(s.toLowerCase(), ctx.settings.get().pinyinStyle)).join(' ');

  function renderDef(def: string): HTMLElement {
    const li = h('li');
    for (const part of parseDefinition(def)) {
      if (part.t === 'text') li.appendChild(document.createTextNode(part.s));
      else li.appendChild(refLink(part.simp, part.pinyin));
    }
    return li;
  }

  function classifierLine(cls: Classifier[]): HTMLElement {
    const line = h('p.pp-cl', null, h('span.pp-cl-label', null, 'Measure word'));
    cls.forEach((c, i) => {
      if (i > 0) line.appendChild(document.createTextNode(','));
      line.append(' ', refLink(c.simp, c.pinyin));
    });
    return line;
  }

  function readingBlock(g: ReadingGroup, headTrad: string, inSentence: boolean): HTMLElement {
    const { rest, classifiers } = splitClassifiers(g.defs);
    const head = h('div.pp-reading-head', null, pinyinSpans(ctx, splitSyllables(g.pinyin)));
    if (g.trad !== headTrad && g.trad !== g.simp) head.appendChild(h('span.pp-reading-trad.zh', null, g.trad));
    if (inSentence) head.appendChild(h('span.chip.chip-accent', null, 'reading in this sentence'));
    const block = h('section.pp-reading', null, head);
    if (rest.length) block.appendChild(h('ol.pp-defs', null, rest.map(renderDef)));
    if (classifiers.length) block.appendChild(classifierLine(classifiers));
    return block;
  }

  function charCard(ch: string, syl: string, v: View): HTMLElement {
    const info = dict.char(ch);
    const gloss = firstGloss(ch, syl);
    const meta: string[] = [];
    if (info?.radical) meta.push(`radical ${info.radical.radicalChar || info.radical.char}`);
    if (info?.strokes) meta.push(`${info.strokes} strokes`);
    return h('button.pp-card', { onclick: () => push(v), title: `Look up ${ch}` },
      h('span.pp-card-glyph.zh', null, ch),
      syl ? pinyinSpans(ctx, [syl]) : h('span.pp-py'),
      h('span.pp-card-gloss', null, gloss || 'No definition'),
      h('span.pp-card-meta', null, meta.join(' · ')),
    );
  }

  function facts(info: CharInfo, v: View): HTMLElement {
    const rows: [string, Node | string][] = [];
    if (info.radical) {
      const r = info.radical;
      const shown = r.radicalChar || r.char;
      const unified = r.char && r.char !== shown ? ` (${r.char})` : '';
      rows.push(['Radical', h('span', null, h('span.zh', null, shown), `${unified}, no. ${r.num}, plus ${r.residual} stroke${r.residual === 1 ? '' : 's'}`)]);
    }
    if (info.strokes !== null) rows.push(['Strokes', String(info.strokes)]);
    const links = (label: string, chars: string[]) => {
      if (chars.length) rows.push([label, h('span.pp-glyphs', null, chars.map((c) => glyphLink(c, { prev: v.prev, next: v.next })))]);
    };
    links('Simplified', info.simplified);
    links('Traditional', info.traditional);
    links('Variants', info.variants);
    if (info.compatOf) rows.push(['Compatibility form of', glyphLink(info.compatOf)]);
    rows.push(['Code point', `${codePointLabel(info.char)}, ${info.block}`]);
    const dl = h('dl.pp-facts');
    for (const [k, val] of rows) dl.append(h('dt', null, k), h('dd', null, val));
    return dl;
  }

  function sourceNote(info: CharInfo, hasCedict: boolean): HTMLElement | null {
    if (info.source === 'variant') {
      return h('p.pp-note', null, 'This character has no entry of its own. The reading and meaning above come from a related character.');
    }
    if (info.source === 'none' && !hasCedict) {
      return h('p.pp-note', null, 'No reading or meaning for this character is in the built-in data. It is rare. The facts below and the links at the bottom may help.');
    }
    if (hasCedict) return null;
    const from = info.source === 'wiktionary' ? 'Wiktionary' : info.source === 'cedict' ? 'CC-CEDICT' : 'Unihan';
    return h('p.pp-note', null, `Not in the CC-CEDICT word list. Reading and meaning from ${from}.`);
  }

  function links(word: string): HTMLElement {
    const w = encodeURIComponent(word);
    const a = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text, icon('external'));
    return h('nav.pp-links', { 'aria-label': 'Other dictionaries' },
      a(`https://www.mdbg.net/chinese/dictionary?page=worddict&wdrst=0&wdqb=${w}`, 'MDBG'),
      a(`https://en.wiktionary.org/wiki/${w}`, 'Wiktionary'),
      a(`https://www.zdic.net/hans/${w}`, '汉典'),
    );
  }

  // ---- save / known

  function headwords(v: View, entries: DictEntry[]) {
    const e = entries.find((x) => x.simp === v.word || x.trad === v.word) ?? entries[0];
    const simp = e ? e.simp : dict.toSimplified(v.word);
    const trad = e ? e.trad : v.word;
    return { simp, trad: trad === simp ? '' : trad };
  }

  async function toggleSave(v: View) {
    const entries = entriesFor(v.word);
    const { simp, trad } = headwords(v, entries);
    const existing = (await store.vocab.get(simp)) ?? (await store.vocab.get(v.word));
    if (existing) {
      await store.vocab.remove(existing.id);
      return;
    }
    const info = ONE_CHAR(v.word) ? dict.char(v.word) : null;
    const syllables = contextSyllables(v);
    const gloss = bookEntry(v.word)?.gloss || shortGloss(entriesForReading(entries, syllables).slice(0, 1)) || shortGloss(entries) || info?.definition.split(';').slice(0, 2).join(';').trim() || '';
    const item: VocabItem = {
      id: simp,
      simp,
      trad: trad || simp,
      pinyin: syllables.filter(Boolean).join(' ').toLowerCase(),
      gloss,
      addedAt: Date.now(),
      srs: newSrs(Date.now()),
    };
    if (o.context?.sentence) {
      item.context = { sentence: o.context.sentence, bookId: o.context.bookId, bookTitle: o.context.bookTitle, chapter: o.context.chapter };
    }
    await store.vocab.put(item);
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
    const { simp, trad } = headwords(v, entries);
    const syllables = contextSyllables(v);
    const hsk = dict.hsk(simp);
    const root = h('div.pp-word-view');

    // Header
    const saveBtn = h('button.icon-btn.pp-save', { onclick: () => void toggleSave(v), title: 'Save word (S)', 'aria-label': 'Save word' });
    const knownBtn = h('button.icon-btn.pp-known', { onclick: () => void toggleKnown(v), title: 'Mark as known (K)', 'aria-label': 'Mark as known' });
    const sync = () => {
      const saved = store.vocab.has(simp) || store.vocab.has(v.word);
      saveBtn.replaceChildren(icon(saved ? 'starFill' : 'star'));
      saveBtn.setAttribute('aria-pressed', String(saved));
      saveBtn.title = saved ? 'Remove from saved words (S)' : 'Save word (S)';
      const known = store.known.has(simp) || store.known.has(v.word);
      knownBtn.replaceChildren(icon('checkCircle'));
      knownBtn.setAttribute('aria-pressed', String(known));
      knownBtn.title = known ? 'Known. Click to unmark (K)' : 'Mark as known (K)';
    };
    sync();
    refreshers.push(sync);

    const showBack = stack.length > 1 || !!o.onBack;
    const speakBtn = canSpeak()
      ? h('button.icon-btn.pp-speak', { onclick: (e: Event) => playToggle(e.currentTarget as HTMLElement, v), title: 'Pronounce (P)', 'aria-label': 'Pronounce' }, icon('speaker'))
      : null;
    const closeBtn = h('button.icon-btn.pp-close', { onclick: () => host.close(), title: 'Close (Esc)', 'aria-label': 'Close' }, icon('close'));

    root.appendChild(h('header.pp-head', null,
      showBack ? h('button.icon-btn.pp-back', { onclick: back, title: 'Back', 'aria-label': 'Back' }, icon('arrowLeft')) : null,
      h('div.pp-title', null,
        h('span.pp-word.zh', null, single ? v.word : simp || v.word),
        trad && trad !== simp && !single ? h('span.pp-trad.zh', null, trad) : null,
      ),
      h('div.pp-head-actions', null, speakBtn, saveBtn, knownBtn, closeBtn),
    ));

    const pyLine = h('div.pp-pyline');
    if (syllables.length) pyLine.appendChild(pinyinSpans(ctx, syllables));
    if (hsk?.hsk3) pyLine.appendChild(h('span.chip', null, hsk.hsk3 >= 7 ? 'HSK 7-9' : `HSK ${hsk.hsk3}`));
    if (single) {
      const other = v.word !== simp ? ['Simplified', [simp]] as const
        : trad && trad !== v.word ? ['Traditional', [trad]] as const
        : info?.traditional.length ? ['Traditional', info.traditional] as const
        : info?.simplified.length ? ['Simplified', info.simplified] as const
        : null;
      if (other) pyLine.appendChild(h('span.pp-trad-note', null, other[0] + ' ', h('span.zh', null, other[1].join(' '))));
    }
    root.appendChild(pyLine);


    const body = h('div.pp-body');
    root.appendChild(body);

    // Names and terms of this book come first: the dictionary has nothing for them.
    const own = bookEntry(v.word);
    const env = cardEnv();
    if (own && env) body.appendChild(bookCard(env, own));

    const senses = entriesForReading(entries, syllables).flatMap(e => splitClassifiers(e.defs).rest).map(plainDefinition).filter(Boolean);
    if (!senses.length && info?.definition) senses.push(...info.definition.split(/;\s*/).filter(Boolean));
    const hasTargetContext = !!o.context?.paragraph && [v.word, dict.toSimplified(v.word), dict.toTraditional(v.word)].some(w => o.context!.paragraph!.includes(w));
    const contextual = hasTargetContext && !own ? dictionaryContextMeaning(v.word, o.context!.paragraph!, senses) : null;
    if (contextual) body.appendChild(h('section.pp-context', null,
      h('span.pp-section', null, 'In this sentence'), h('strong', null, contextual.meaning), h('p.pp-muted', null, contextual.reason)));

    // Definitions per reading
    if (entries.length) {
      const ordered = orderGroups(groupByReading(entriesForReading(entries, syllables)), v.reading ? splitSyllables(v.reading) : syllables);
      const hasContext = !!(o.context?.sentence || o.prev || o.next) && stack.length === 1;
      const flag = ordered.matched && hasContext && ordered.groups.some(g => !sameReading(g.pinyin, syllables));
      const ambiguous = ordered.groups.length > 1 || ordered.groups.some((g) => splitClassifiers(g.defs).rest.length > 1);
      ordered.groups.forEach((g, i) => body.appendChild(readingBlock(g, trad, flag && i === 0)));
      // The note points at Translate sentence, which comes right after the definitions.
      if (hasContext && !own && ambiguous) body.appendChild(h('p.pp-note', null,
        'These are dictionary meanings, not a choice of meaning for this sentence. Use Translate sentence to check the context.'));
    } else if (info) {
      const note = sourceNote(info, false);
      if (info.readings.length || info.definition) {
        const sec = h('section.pp-reading', null);
        if (info.readings.length) {
          sec.appendChild(h('div.pp-reading-head', null, ...info.readings.map((r) => h('span.pp-py', null, h('span.pp-syl', { class: `tone-${toneOf(r)}` }, formatSyllable(markedToNumbered(r), ctx.settings.get().pinyinStyle))))));
        }
        if (info.definition) {
          sec.appendChild(h('ol.pp-defs', null, info.definition.split(/;\s*/).filter(Boolean).map((d) => h('li', null, d))));
        }
        body.appendChild(sec);
      }
      if (note) body.appendChild(note);
    } else if (!single && !own) {
      body.appendChild(h('p.pp-note', null, 'This combination is not in the dictionary as a word. Each character is shown below.'));
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
      }, icon('translate'), 'Translate sentence'));
    }
    if (stack.length === 1 && o.onReadFromHere && canSpeak()) readingActions.appendChild(h('span.pp-read-from', null,
      h('button.btn.btn-sm', { type: 'button', title: 'Start at this word and continue to the end of the chapter',
        onclick: () => { host.close(); o.onReadFromHere!(); } }, icon('play'), 'Read from here')));
    if (readingActions.childElementCount) body.appendChild(readingActions);

    // A local model can suggest a contextual sense, but the dictionary stays visible for checking it.
    if (!contextual && hasTargetContext && o.context?.sentence && o.context.paragraph && hasMacBridge()) {
      if (senses.length) {
        const result = h('div.pp-context-result');
        const btn = h('button.btn.btn-sm', { type: 'button' }, icon('sparkle'), 'Ask local AI about context') as HTMLButtonElement;
        btn.addEventListener('click', async () => {
          meaningCtl?.abort();
          const ctl = (meaningCtl = new AbortController());
          btn.disabled = true;
          result.replaceChildren(h('span.app-spinner'), ' Checking with your Mac…');
          host.reposition();
          try {
            const suggestion = await suggestMeaning(v.word, o.context!.sentence, o.context!.paragraph!, senses, ctl.signal);
            if (ctl.signal.aborted) return;
            result.replaceChildren(
              h('strong', null, suggestion.meaning),
              // The English rationale can invent subjects. Show the exact dictionary sense
              // and checked source quote, not a second, unverifiable AI paraphrase.
              ...(suggestion.evidence ? [h('p.pp-muted.zh', null, `Context clue: “${suggestion.evidence}”`)] : []),
              h('p.pp-muted', null, suggestion.confidence === 'medium' ? 'Tentative AI suggestion — check the surrounding passage.' : 'AI suggestion — not a verified definition.'),
            );
          } catch (e) {
            if (ctl.signal.aborted) return;
            result.textContent = e instanceof Error ? e.message : 'The local model could not answer.';
            btn.disabled = false;
          }
          host.reposition();
        });
        body.appendChild(h('section.pp-context', null,
          h('span.pp-section', null, 'Context'), btn, result,
          h('p.pp-muted', null, 'AI suggestion; compare it with the dictionary senses.')));
      }
    }

    // Character breakdown (multi-character words)
    if (!single) {
      const cards = h('div.pp-cards');
      const codePoints = chars;
      const py = dict.pinyinFor(v.word, { prev: v.prev, next: v.next });
      codePoints.forEach((ch, i) => {
        const syl = py[i] || (dict.char(ch)?.readings[0] ? markedToNumbered(dict.char(ch)!.readings[0]) : '');
        cards.appendChild(charCard(ch, syl, { word: ch, prev: i > 0 ? codePoints[i - 1] : v.prev, next: i < codePoints.length - 1 ? codePoints[i + 1] : v.next }));
      });
      body.appendChild(h('section.pp-chars', null, h('span.pp-section', null, 'Characters'), cards));
    }

    // Single-character facts and stroke order
    if (single && info) {
      body.appendChild(h('section.pp-char-facts', null, h('span.pp-section', null, 'Character'), facts(info, v)));
      body.appendChild(createStrokeOrder(v.word, () => host.reposition()));
    }

    body.appendChild(links(v.word));

    // Footer: stepping and sentence translation (reader only)
    const foot = h('footer.pp-foot');
    const atRoot = stack.length === 1;
    if (atRoot && (o.onStep || o.onResize)) {
      const tools = h('div.pp-tools');
      if (o.onStep) {
        tools.append(
          h('button.btn.btn-sm.btn-ghost', { onclick: () => o.onStep!(-1), title: 'Previous word (Left arrow)' }, icon('chevronLeft'), 'Prev'),
          h('button.btn.btn-sm.btn-ghost', { onclick: () => o.onStep!(1), title: 'Next word (Right arrow)' }, 'Next', icon('chevronRight')),
        );
      }
      if (o.onResize) {
        tools.append(
          h('button.btn.btn-sm.btn-ghost', { onclick: () => o.onResize!(-1), title: 'Shorter (Shift+Left)' }, icon('minus'), 'Shorter'),
          h('button.btn.btn-sm.btn-ghost', { onclick: () => o.onResize!(1), title: 'Longer (Shift+Right)' }, icon('plus'), 'Longer'),
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
    refreshers.length = 0;
    clear(host.content);
    host.content.appendChild(build(top()));
    host.el.scrollTop = 0;
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
      off();
      if (speaking) stopSpeaking();
    },
  };
}
