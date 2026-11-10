// The phrase popup's content: the selected text with pinyin, speak and copy, a streaming translation, and a
// word-by-word list whose rows open the word popup.
import type { Dictionary, Token } from '../../types';
import { properGroups } from '../../core/names';
import { speak, stopSpeaking, canSpeak } from '../../speech/tts';
import { h } from '../dom';
import { icon } from '../icons';
import { renderParagraph, displayTokens } from '../reader/render';
import { plainDefinition, splitClassifiers } from './defs';
import type { PopupHost } from './host';
import type { PhrasePopupOptions } from './popup';
import { addWordControl } from './bookCard';
import { phraseFixControls } from './fixView';
import { pinyinSpans } from './pinyinText';
import { createTranslationPanel } from './translation';
import { entriesForReading } from '../../core/reading';
import { activeEngine, lang } from '../../lang/active';
import { safeLookup, shortGlossOf } from '../../lang/words';
import { tt, ttn } from '../../i18n';

export interface PhraseView {
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

const MAX_ROWS = 60;

interface Row { word: string; syllables: string[]; reading?: string[]; prev?: string; next?: string; token?: Token }

export function mountPhraseView(
  host: PopupHost,
  o: PhrasePopupOptions,
  dict: Dictionary,
  openWord: (row: Row, anchor: DOMRect) => void,
): PhraseView {
  const { ctx } = o;
  const settings = ctx.settings.get();
  const lines = o.text.split('\n').filter((l) => l.trim());
  // The book's spelling, line for line (conversion leaves the line breaks and spaces where they are).
  const origLines = o.orig?.split('\n').filter((l) => l.trim());
  const origOf = (k: number) => (origLines?.length === lines.length ? origLines[k] : undefined);
  let speaking = false;
  const engine = activeEngine();
  const L = lang();

  // Pinyin text, one paragraph per line (another language: its words, with furigana for Japanese).
  const textBox = h(engine ? 'div.pp-phrase-text' : 'div.pp-phrase-text.zh', engine ? { lang: L.tag } : null);
  const rows: Row[] = [];
  lines.forEach((line, k) => {
    const p = renderParagraph(line, dict, { tag: 'p', className: 'pp-line', style: settings.pinyinStyle, toneColors: settings.toneColors, sandhi: settings.sandhi, lexicon: o.lexicon, orig: origOf(k) });
    textBox.appendChild(p.el);
    const shown = displayTokens(p.tokens, settings.sandhi);
    shown.forEach((t: Token, i) => {
      if (t.kind === 'word') {
        rows.push({ word: t.text, syllables: [], token: t, prev: shown[i - 1]?.text, next: shown[i + 1]?.text });
        return;
      }
      if (t.kind !== 'han') return;
      rows.push({ word: t.text, syllables: t.pinyin ?? [], reading: p.tokens[i]?.pinyin,
        prev: shown[i - 1]?.text, next: shown[i + 1]?.text });
    });
  });

  const copy = async (btn: HTMLElement) => {
    let ok = false;
    try { await navigator.clipboard.writeText(o.text); ok = true; } catch { /* fall through */ }
    if (!ok) {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' }, o.text);
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    btn.classList.toggle('pp-on', ok);
    ctx.toast(ok ? tt('Copied') : tt('Could not copy. Select the text and press Ctrl+C.'), { ms: 1600 });
    setTimeout(() => btn.classList.remove('pp-on'), 1200);
  };

  const playToggle = (btn: HTMLElement) => {
    if (speaking) { stopSpeaking(); speaking = false; btn.classList.remove('pp-on'); return; }
    speaking = true;
    btn.classList.add('pp-on');
    const s = ctx.settings.get();
    void speak(o.text, { rate: s.ttsRate, voice: s.ttsVoice, onError: message => ctx.toast(message) }).finally(() => { speaking = false; btn.classList.remove('pp-on'); });
  };

  const speakBtn = canSpeak()
    ? h('button.icon-btn.pp-speak', { onclick: (e: Event) => playToggle(e.currentTarget as HTMLElement), title: tt('Read aloud (P)'), 'aria-label': tt('Read aloud') }, icon('speaker'))
    : null;
  const copyBtn = h('button.icon-btn.pp-copy', { onclick: (e: Event) => void copy(e.currentTarget as HTMLElement), title: tt('Copy text'), 'aria-label': tt('Copy text') }, icon('copy'));
  const closeBtn = h('button.icon-btn.pp-close', { onclick: () => host.close(), title: tt('Close (Esc)'), 'aria-label': tt('Close') }, icon('close'));

  // A language with spaces counts words; Chinese and Japanese count characters.
  const chars = [...o.text.replace(/\s/g, '')].length;
  const head = h('header.pp-head', null,
    o.onBack ? h('button.icon-btn.pp-back', { onclick: () => o.onBack!(), title: tt('Back'), 'aria-label': tt('Back') }, icon('arrowLeft')) : null,
    h('div.pp-title', null, h('span.pp-kind', null, tt('Phrase')), h('span.pp-muted', null, engine && L.spaced
      ? ttn(rows.length, '{n} word', '{n} words') : ttn(chars, '{n} characters', '{n} characters'))),
    h('div.pp-head-actions', null, speakBtn, copyBtn, closeBtn),
  );

  const translation = createTranslationPanel({ ctx, text: o.text.replace(/\n+/g, '\n'), context: o.context, lexicon: o.lexicon, onResize: () => host.reposition(), hasWordList: rows.length > 0 });

  // Word by word
  const list = h('div.pp-wbw-list');
  const renderRows = (upTo: number) => {
    list.textContent = '';
    rows.slice(0, upTo).forEach((r) => {
      if (engine) {
        // Another language: the word, its reading (Japanese), and the first meaning of the entry it most likely is.
        const lu = safeLookup(engine, r.word, r.token, o.context);
        const reading = r.token?.reading && r.token.reading !== r.word ? r.token.reading : '';
        list.appendChild(h('button.pp-wbw', { onclick: (e: Event) => openWord(r, (e.currentTarget as HTMLElement).getBoundingClientRect()) },
          h('span.pp-wbw-word', { lang: L.tag }, r.word),
          reading ? h('span.pp-py', { lang: L.tag }, reading) : h('span.pp-py'),
          h('span.pp-wbw-gloss', null, shortGlossOf(lu.entries, 60) || (lu.name || r.token?.name ? tt('name') : ''))));
        return;
      }
      const first = entriesForReading(dict.lookup(r.word), r.syllables, r.word, { prev: r.prev, next: r.next })[0];
      const own = o.lexicon && (o.lexicon.get(r.word) || o.lexicon.get(dict.toSimplified(r.word)) || o.lexicon.get(dict.toTraditional(r.word)));
      let gloss = '';
      if (own?.gloss) gloss = own.gloss;
      else if (first) {
        const { rest } = splitClassifiers(first.defs);
        gloss = plainDefinition(rest[0] ?? first.defs[0] ?? '');
      } else if ([...r.word].length === 1) {
        gloss = dict.char(r.word)?.definition.split(';')[0].trim() ?? '';
      }
      // A name of the book or a proper noun of the dictionary is written with capitals (Guō Jìng, Cáo Cāo); a word, as it is.
      const proper = own ? null : properGroups(dict.lookup(r.word), r.syllables);
      const py = pinyinSpans(ctx, r.syllables, own ? { kind: own.kind, word: r.word } : proper ? { kind: 'name', word: r.word, groups: proper } : undefined);
      list.appendChild(h('button.pp-wbw', {
        onclick: (e: Event) => openWord(r, (e.currentTarget as HTMLElement).getBoundingClientRect()),
      }, h('span.pp-wbw-word.zh', null, r.word), py, h('span.pp-wbw-gloss', null, gloss)));
    });
    if (rows.length > upTo) {
      list.appendChild(h('button.btn.btn-sm.btn-ghost.pp-wbw-more', { onclick: () => { renderRows(rows.length); host.reposition(); } },
        ttn(rows.length, 'Show all {n} word', 'Show all {n} words')));
    }
  };
  renderRows(MAX_ROWS);

  // A short selection that is not a word yet can become one (a name the detector missed): in the reader, joined as one word or marked
  // as a name (here only or everywhere, fixView.ts); elsewhere, added as a word of the book.
  const hanOnly = o.text.replace(/\s/g, '');
  const target = o.fix?.target;
  const isEntry = !!o.lexicon && [hanOnly, dict.toSimplified(hanOnly), dict.toTraditional(hanOnly)].some((w) => o.lexicon!.has(w));
  // The pinyin to start from: one syllable for each character (the page's readings, else the rows', else the dictionary's).
  const fits = (py: readonly string[]) => !!target && py.length === [...target.word].length && py.every(Boolean);
  const rowPinyin = rows.flatMap((r) => r.syllables);
  const startPinyin = target ? (fits(target.pinyin) ? target.pinyin : fits(rowPinyin) ? rowPinyin : dict.pinyinFor(target.shown, {})) : [];
  const addWord = target && !isEntry
    ? phraseFixControls(ctx, dict, host, { fixer: o.fix!.fixer, target: { ...target, pinyin: startPinyin } })
    : o.bookId && /^\p{Script=Han}{2,8}$/u.test(hanOnly)
      ? addWordControl(
        { ctx, bookId: o.bookId, lexicon: o.lexicon, onLexiconChange: o.onLexiconChange, close: () => host.close(), reposition: () => host.reposition(), fixer: o.fix?.fixer },
        { word: hanOnly, pinyin: rows.flatMap((r) => r.syllables).filter(Boolean).join(' ') },
      )
      : null;

  host.content.append(
    head,
    // The translation is the one thing a reader selected a phrase for, so it comes first: on a sheet that is not tall it
    // would otherwise sit under the repeated pinyin and the Read button, below the fold.
    h('div.pp-body', null,
      translation.el,
      textBox,
      o.onReadFromHere && canSpeak() ? h('div.pp-read-from', null,
        h('button.btn.btn-sm', { type: 'button', title: tt('Start at this selection and continue to the end of the chapter'),
          onclick: () => { host.close(); o.onReadFromHere!(); } }, icon('play'), tt('Read from here'))) : null,
      addWord,
      rows.length ? h('section.pp-wbw-sec', null,
        h('span.pp-section', null, tt('Word by word')),
        h('p.pp-wbw-note.muted', null, tt('The first dictionary meaning of each word, which may not be the one used here. Tap a word for all of them.')),
        list) : null,
    ),
  );
  host.placeNow();

  return {
    onKey(e) {
      if ((e.key === 'p' || e.key === 'P') && canSpeak()) { playToggle(host.content.querySelector('.pp-speak') ?? document.body); return true; }
      return false;
    },
    dispose() {
      translation.destroy();
      if (speaking) stopSpeaking();
    },
  };
}
