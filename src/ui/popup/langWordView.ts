// The word card for a language other than Chinese (lang/types.ts): the word as on the page and its reading, how it relates
// to its dictionary form ("past tense of 食べる"), every entry it can be with its senses, the pieces of a word that is several
// (dámelo, l'homme, Haustür), the kanji of a Japanese word, and the same Save / Known / Pronounce / Translate controls.
import type { Token } from '../../types';
import type { KanjiInfo, LangEngine, WordEntry, WordLookup } from '../../lang/types';
import { lang } from '../../lang/active';
import { levelLabel } from '../../lang/labels';
import { headOf, langVocabItem, safeLookup } from '../../lang/words';
import { speak, stopSpeaking, canSpeak } from '../../speech/tts';
import { h, clear } from '../dom';
import { icon } from '../icons';
import type { PopupHost } from './host';
import type { WordPopupOptions } from './popup';
import type { WordView } from './wordView';
import { withNodes } from './defs';
import { tt, ttm, ttn } from '../../i18n';

interface View {
  word: string;
  /** The token the word was cut as on the page (it carries the lemma); absent for a piece or a kanji opened from the card. */
  token?: Token;
}

/** Senses beyond this many (per entry) sit behind a "more" button. */
const SENSE_LIMIT = 4;

const GENDER: Record<string, string> = {
  m: ttm('masculine'), f: ttm('feminine'), n: ttm('neuter'), 'm/f': ttm('masculine or feminine'), pl: ttm('plural only'),
};

/** Other dictionaries for the language, by the word's dictionary form. */
function links(head: string): HTMLElement {
  const w = encodeURIComponent(head);
  const a = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text, icon('external'));
  const own: Record<string, [string, string]> = {
    ja: [`https://jisho.org/search/${w}`, 'Jisho'],
    es: [`https://dle.rae.es/${w}`, 'RAE'],
    fr: [`https://www.larousse.fr/dictionnaires/francais/${w}`, 'Larousse'],
    de: [`https://www.dwds.de/wb/${w}`, 'DWDS'],
    it: [`https://www.treccani.it/vocabolario/ricerca/${w}/`, 'Treccani'],
    pt: [`https://dicionario.priberam.org/${w}`, 'Priberam'],
    ru: [`https://ru.wiktionary.org/wiki/${w}`, 'Викисловарь'],
  };
  const extra = own[lang().id];
  return h('nav.pp-links', { 'aria-label': tt('Other dictionaries') },
    a(`https://en.wiktionary.org/wiki/${w}#${encodeURIComponent(lang().name)}`, 'Wiktionary'),
    extra ? a(extra[0], extra[1]) : null);
}

const ASPECT: Record<'pf' | 'impf' | 'both', string> = { pf: ttm('Perfective'), impf: ttm('Imperfective'), both: ttm('Both aspects') };
/** A phone held upright: a touch screen too narrow for five buttons and the word on one row. */
const narrowTouch = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse) and (max-width: 480px)').matches;

/**
 * How wide the headword is per px of type, so popup.css can size it to fit the room beside the buttons on one line. Its
 * length (--len) stands in until this runs, and wherever there is no layout; letters differ (Kindern, медвежонок).
 */
function measureHeadword(el: HTMLElement | null): void {
  if (!el?.parentElement) return;
  const probe = el.cloneNode(true) as HTMLElement;
  probe.style.cssText += ';position:absolute;visibility:hidden;white-space:nowrap;font-size:100px;width:auto;max-width:none;min-width:0';
  el.parentElement.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  // A little to spare, so a word that just fits is not broken by rounding.
  if (w > 0) el.parentElement.style.setProperty('--em', (w / 100 * 1.03 + 0.02).toFixed(3));
}

/** A stress-marked word as the book prints it (узна́ть → узнать); й and ё keep their marks. */
const unstressed = (w: string): string => w.normalize('NFD').replace(/\u0301/g, '').normalize('NFC');

export function mountLangWordView(
  host: PopupHost,
  o: WordPopupOptions,
  engine: LangEngine,
  openPhrase: (text: string, anchor: DOMRect, context?: string) => void,
): WordView {
  const { ctx } = o;
  const store = ctx.store;
  const L = lang();
  const stack: View[] = [{ word: o.word, token: o.token }];
  const refreshers: (() => void)[] = [];
  let speaking = false;

  const top = () => stack[stack.length - 1];
  const push = (v: View) => { stack.push(v); show(); };
  const back = () => {
    if (stack.length > 1) { stack.pop(); show(); } else o.onBack?.();
  };
  const lookupOf = (v: View): WordLookup => safeLookup(engine, v.word, v.token, o.context?.sentence);

  async function toggleSave(v: View, lu: WordLookup) {
    const existing = await store.vocab.get(lu.key);
    if (existing) { await store.vocab.remove(existing.id); return; }
    await store.vocab.put(langVocabItem(lu, { token: v.token, context: stack.length === 1 ? o.context : undefined }));
  }

  async function toggleKnown(lu: WordLookup) {
    if (store.known.has(lu.key)) await store.known.remove([lu.key]);
    else await store.known.add([lu.key]);
  }

  function playToggle(btn: HTMLElement, text: string) {
    if (speaking) { stopSpeaking(); speaking = false; btn.classList.remove('pp-on'); return; }
    speaking = true;
    btn.classList.add('pp-on');
    const s = ctx.settings.get();
    void speak(text, { rate: s.ttsRate, voice: s.ttsVoice, lang: L.tag, onError: (message) => ctx.toast(message) })
      .finally(() => { speaking = false; btn.classList.remove('pp-on'); });
  }

  /** One entry: its headword (when it is not the word on the page, or has a reading to show), part of speech, senses. */
  function entryBlock(e: WordEntry, v: View, many: boolean, said?: string): HTMLElement {
    const block = h('section.pp-reading.pp-lang-entry');
    const showHead = many || e.head !== v.word || (e.reading && e.reading !== e.head);
    const chips: (Node | null)[] = [];
    if (e.gender && GENDER[e.gender]) chips.push(h('span.chip', { title: tt(GENDER[e.gender]) }, e.gender === 'm/f' ? 'm/f' : e.gender));
    // One entry: its level is on the line under the word already.
    if (e.level && many) chips.push(h('span.chip', null, levelLabel(e.level)));
    if (showHead || chips.length) {
      block.appendChild(h('div.pp-reading-head', null,
        showHead ? h('span.pp-lang-head', { lang: L.tag }, e.head) : null,
        showHead && e.reading && e.reading !== e.head ? h('span.pp-lang-reading', { lang: L.tag }, e.reading) : null,
        // English: how the headword is said, when it is not what the line under the word already says (went: go /ɡəʊ/).
        showHead && e.sound && e.sound !== said ? h('span.pp-lang-reading.pp-lang-ipa', { lang: 'en-fonipa' }, e.sound) : null,
        e.alts?.length ? h('span.pp-trad-note', null, withNodes(tt('Also {forms}'), { forms: h('span', { lang: L.tag }, e.alts.slice(0, 4).join(', ')) })) : null,
        ...chips));
    }
    // A Russian verb's aspect and its pair (взять: perfective, pair брать), the pair a tap away.
    if (e.aspect) {
      const pairs = (e.partners ?? []).slice(0, 3).map((p, i) => [i ? ', ' : null,
        h('button.pp-xref', { type: 'button', onclick: () => push({ word: unstressed(p) }) }, h('span', { lang: L.tag }, p))]);
      const aspect = tt(ASPECT[e.aspect]);
      block.appendChild(h('p.pp-lang-aspect', null, pairs.length
        ? withNodes(ttn(pairs.length, '{aspect} · pair {words}', '{aspect} · pairs {words}', { aspect }), { words: pairs.flat() })
        : aspect));
    }
    // Senses with the same part of speech run on under one label, as a printed dictionary sets them.
    const items: HTMLElement[] = [];
    let lastPos = '';
    for (const s of e.senses) {
      const label = s.pos && s.pos !== lastPos ? h('span.pp-pos', null, s.pos) : null;
      lastPos = s.pos ?? lastPos;
      items.push(h('li', null, label, label ? ' ' : null, s.glosses.join('; '),
        s.notes?.length ? h('span.pp-sense-note', null, ` (${s.notes.join(', ')})`) : null));
    }
    if (items.length) {
      const list = h('ol.pp-defs', null, items.slice(0, SENSE_LIMIT));
      block.appendChild(list);
      if (items.length > SENSE_LIMIT) {
        const hidden = items.length - SENSE_LIMIT;
        const more = h('button.pp-more-btn', { type: 'button', 'aria-expanded': 'false' }, ttn(hidden, '{n} more', '{n} more')) as HTMLButtonElement;
        more.addEventListener('click', () => { list.append(...items.slice(SENSE_LIMIT)); more.remove(); host.reposition(); });
        block.appendChild(more);
      }
    }
    return block;
  }

  /** A kanji of a Japanese word as a chip: the character, a reading, a few words of meaning. Opens the kanji. */
  function kanjiCard(k: KanjiInfo): HTMLElement {
    const reading = k.kun[0] ?? k.on[0] ?? '';
    return h('button.pp-card', { type: 'button', onclick: () => push({ word: k.char }), title: tt('Look up {word}', { word: k.char }) },
      h('span.pp-card-glyph', { lang: 'ja' }, k.char),
      reading ? h('span.pp-py', { lang: 'ja' }, reading) : null,
      h('span.pp-card-gloss', null, k.meanings.slice(0, 3).join(', ') || tt('No meaning listed')));
  }

  /** The facts of a single kanji (opened from a word's kanji). */
  function kanjiFacts(k: KanjiInfo): HTMLElement {
    // [label, value, the value is Japanese (the readings)]
    const rows: [string, string, boolean?][] = [];
    if (k.meanings.length) rows.push([tt('Meanings'), k.meanings.join(', ')]);
    if (k.on.length) rows.push([tt('On readings'), k.on.join('、'), true]);
    if (k.kun.length) rows.push([tt('Kun readings'), k.kun.join('、'), true]);
    if (k.strokes) rows.push([tt('Strokes'), String(k.strokes)]);
    if (k.grade) rows.push([tt('Taught'), k.grade <= 6 ? tt('Grade {grade}', { grade: k.grade }) : k.grade === 8 ? tt('Secondary school') : tt('Used in names')]);
    if (k.jlpt) rows.push([tt('JLPT (old)'), tt('Level {level}', { level: k.jlpt })]);
    const dl = h('dl.pp-facts');
    for (const [a, b, ja] of rows) dl.append(h('dt', null, a), h('dd', { lang: ja ? 'ja' : null }, b));
    return dl;
  }

  function build(v: View): HTMLElement {
    const lu = lookupOf(v);
    const { head, reading } = headOf(lu, v.token);
    const root = h('div.pp-word-view.pp-lang');

    const saveBtn = h('button.icon-btn.pp-save', { onclick: () => void toggleSave(v, lu), title: tt('Save word (S)'), 'aria-label': tt('Save word') });
    const knownBtn = h('button.icon-btn.pp-known', { onclick: () => void toggleKnown(lu), title: tt('Mark as known (K)'), 'aria-label': tt('Mark as known') });
    const sync = () => {
      const saved = store.vocab.has(lu.key);
      saveBtn.replaceChildren(icon(saved ? 'starFill' : 'star'));
      saveBtn.setAttribute('aria-pressed', String(saved));
      saveBtn.title = saved ? tt('Remove from saved words (S)') : tt('Save word (S)');
      const known = store.known.has(lu.key);
      const learned = known && store.known.isAuto(lu.key);
      knownBtn.replaceChildren(icon('checkCircle'));
      knownBtn.setAttribute('aria-pressed', String(known));
      knownBtn.classList.toggle('pp-learned', learned);
      knownBtn.title = learned ? tt('Learned from reading. Click to unmark (K)') : known ? tt('Known. Click to unmark (K)') : tt('Mark as known (K)');
      knownBtn.setAttribute('aria-label', learned ? tt('Known, learned from reading') : tt('Mark as known'));
    };
    sync();
    refreshers.push(sync);

    const showBack = stack.length > 1 || !!o.onBack;
    const speakBtn = canSpeak()
      ? h('button.icon-btn.pp-speak', { onclick: (e: Event) => playToggle(e.currentTarget as HTMLElement, v.word), title: tt('Pronounce (P)'), 'aria-label': tt('Pronounce') }, icon('speaker'))
      : null;
    const closeBtn = h('button.icon-btn.pp-close', { onclick: () => host.close(), title: tt('Close (Esc)'), 'aria-label': tt('Close') }, icon('close'));
    // A phone has the same Translate sentence button in the body; the header's would take the room the word needs.
    const translateBtn = o.context?.sentence && stack.length === 1 && !narrowTouch()
      ? h('button.icon-btn.pp-translate', { type: 'button', title: tt('Translate sentence'), 'aria-label': tt('Translate sentence'),
        onclick: (e: Event) => openPhrase(o.context!.sentence, (e.currentTarget as HTMLElement).getBoundingClientRect(), o.context?.paragraph ?? o.context!.sentence) },
      icon('translate'))
      : null;

    // The word as the book has it; its reading (kana, or the stressed spelling) under it.
    const tokReading = v.token?.reading && v.token.reading !== v.word ? v.token.reading : '';
    root.appendChild(h('header.pp-head', null,
      showBack ? h('button.icon-btn.pp-back', { onclick: back, title: tt('Back'), 'aria-label': tt('Back') }, icon('arrowLeft')) : null,
      // Its length sets its size (popup.css), so a long word gets smaller instead of breaking in the middle.
      h('div.pp-title', { style: `--len:${[...v.word].length}` }, h('span.pp-word.pp-lang-word', { lang: L.tag }, v.word)),
      h('div.pp-head-actions', null, speakBtn, translateBtn, saveBtn, knownBtn, closeBtn)));

    const line = h('div.pp-pyline');
    const shownReading = tokReading || (reading && reading !== v.word && head === v.word ? reading : '');
    if (shownReading) line.appendChild(h('span.pp-lang-reading.pp-lang-reading-main', { lang: L.tag }, shownReading));
    // English: how the word on the page is said, in IPA.
    else if (lu.sound) line.appendChild(h('span.pp-lang-reading.pp-lang-reading-main.pp-lang-ipa', { lang: 'en-fonipa' }, lu.sound));
    // The dictionary form, a tap away; {word} marks where the sentence puts it.
    const toHead = () => h('button.pp-xref', { type: 'button', onclick: () => push({ word: head }) }, h('span', { lang: L.tag }, head));
    if (lu.form) {
      line.appendChild(h('span.pp-lang-form', null, head !== v.word ? withNodes(tt('{form} of {word}', { form: lu.form }), { word: toHead() }) : lu.form));
    } else if (head !== v.word && lu.entries.length) {
      line.appendChild(h('span.pp-lang-form', null, withNodes(tt('Dictionary form {word}'), { word: toHead() })));
    }
    const lvl = lu.entries[0]?.level ?? engine.level(lu.key);
    if (lvl && lu.entries.length <= 1) line.appendChild(h('span.chip', null, levelLabel(lvl)));
    if (lu.name || v.token?.name) line.appendChild(h('span.chip', null, tt('Name')));
    if (line.childElementCount) root.appendChild(line);

    const body = h('div.pp-body');
    root.appendChild(body);

    if (lu.entries.length) {
      const many = lu.entries.length > 1;
      lu.entries.slice(0, 6).forEach((e) => body.appendChild(entryBlock(e, v, many, lu.sound)));
      if (many && (o.context?.sentence || v.token)) body.appendChild(h('p.pp-note', null, tt('Every word this can be. The first fits best where it is used here.')));
    } else {
      body.appendChild(h('p.pp-note', null, lu.name || v.token?.name
        ? tt('A name. The dictionary has no entry for it.')
        : tt('Not in the dictionary. Translate the sentence to see it in context.')));
    }

    // Pieces: a word made of several (clitics, elision, a compound) can be looked up one piece at a time.
    if (lu.parts?.length) {
      const cards = h('div.pp-cards');
      for (const p of lu.parts) {
        cards.appendChild(h('button.pp-card', { type: 'button', onclick: () => push({ word: p.text }), title: tt('Look up {word}', { word: p.text }) },
          h('span.pp-card-glyph.pp-lang-part', { lang: L.tag }, p.text),
          p.reading ? h('span.pp-py', { lang: L.tag }, p.reading) : null,
          h('span.pp-card-gloss', null, p.gloss || '')));
      }
      body.appendChild(h('section.pp-chars', null, h('span.pp-section', null, tt('Parts')), cards));
    }

    const actions = h('div.pp-reading-actions');
    if (o.context?.sentence && stack.length === 1) {
      const sentence = o.context.sentence;
      actions.appendChild(h('button.btn.btn-sm', { type: 'button',
        onclick: (e: Event) => openPhrase(sentence, (e.currentTarget as HTMLElement).getBoundingClientRect(), o.context?.paragraph ?? sentence),
      }, icon('translate'), tt('Translate sentence')));
    }
    if (stack.length === 1 && o.onReadFromHere && canSpeak()) actions.appendChild(h('span.pp-read-from', null,
      h('button.btn.btn-sm', { type: 'button', title: tt('Start at this word and continue to the end of the chapter'),
        onclick: () => { host.close(); o.onReadFromHere!(); } }, icon('play'), tt('Read from here'))));
    if (actions.childElementCount) body.appendChild(actions);

    // Japanese: the kanji of a word, or the facts of one kanji.
    if (lu.chars?.length) {
      if ([...v.word].length === 1 && lu.chars.length === 1 && lu.chars[0].char === v.word) {
        body.appendChild(h('section.pp-char-facts', null, h('span.pp-section', null, tt('Kanji')), kanjiFacts(lu.chars[0])));
      } else {
        body.appendChild(h('section.pp-chars', null, h('span.pp-section', null, tt('Kanji')), h('div.pp-cards', null, lu.chars.map(kanjiCard))));
      }
    }

    body.appendChild(links(head));

    const foot = h('footer.pp-foot');
    if (stack.length === 1 && (o.onStep || o.onResize)) {
      const seg = (label: string, title: string, run: () => void, lead: Node | null, trail: Node | null) =>
        h('button.pp-seg-btn', { type: 'button', onclick: run, title }, lead, h('span', null, label), trail);
      const tools = h('div.pp-tools.pp-seg', { role: 'group', 'aria-label': tt('Move or resize the selection') });
      if (o.onStep) tools.append(seg(tt('Prev'), tt('Previous word (Left arrow)'), () => o.onStep!(-1), icon('chevronLeft'), null), seg(tt('Next'), tt('Next word (Right arrow)'), () => o.onStep!(1), null, icon('chevronRight')));
      if (o.onResize) tools.append(seg(tt('Shorter'), tt('Shorter (Shift+Left)'), () => o.onResize!(-1), icon('minus'), null), seg(tt('Longer'), tt('Longer (Shift+Right)'), () => o.onResize!(1), icon('plus'), null));
      foot.appendChild(tools);
    }
    if (foot.childElementCount) root.appendChild(foot);
    return root;
  }

  function show() {
    refreshers.length = 0;
    clear(host.content);
    host.content.appendChild(build(top()));
    measureHeadword(host.content.querySelector<HTMLElement>('.pp-lang-word'));
    host.scroller.scrollTop = 0;
    if (!host.el.contains(document.activeElement)) host.focus();
    host.placeNow();
  }

  const off = store.onChange(() => refreshers.forEach((f) => f()));
  show();
  return {
    onKey(e) {
      const atRoot = stack.length === 1;
      const k = e.key;
      if (atRoot && o.onStep && (k === 'ArrowLeft' || k === 'ArrowRight') && !e.shiftKey) { o.onStep(k === 'ArrowLeft' ? -1 : 1); return true; }
      if (atRoot && o.onResize && (k === 'ArrowLeft' || k === 'ArrowRight') && e.shiftKey) { o.onResize(k === 'ArrowLeft' ? -1 : 1); return true; }
      if (k === 's' || k === 'S') { const v = top(); void toggleSave(v, lookupOf(v)); return true; }
      if (k === 'k' || k === 'K') { void toggleKnown(lookupOf(top())); return true; }
      if ((k === 'p' || k === 'P') && canSpeak()) { playToggle(host.content.querySelector('.pp-speak') ?? document.body, top().word); return true; }
      if (k === 'Backspace' && stack.length > 1) { back(); return true; }
      return false;
    },
    dispose() {
      off();
      if (speaking) stopSpeaking();
    },
  };
}
