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
import { pinyinSpans } from './pinyinText';
import { createTranslationPanel } from './translation';
import { entriesForReading } from '../../core/reading';

export interface PhraseView {
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

const MAX_ROWS = 60;

interface Row { word: string; syllables: string[]; reading?: string[]; prev?: string; next?: string }

export function mountPhraseView(
  host: PopupHost,
  o: PhrasePopupOptions,
  dict: Dictionary,
  openWord: (row: Row, anchor: DOMRect) => void,
): PhraseView {
  const { ctx } = o;
  const settings = ctx.settings.get();
  const lines = o.text.split('\n').filter((l) => l.trim());
  let speaking = false;

  // Pinyin text, one paragraph per line.
  const textBox = h('div.pp-phrase-text.zh');
  const rows: Row[] = [];
  for (const line of lines) {
    const p = renderParagraph(line, dict, { tag: 'p', className: 'pp-line', style: settings.pinyinStyle, toneColors: settings.toneColors, sandhi: settings.sandhi, lexicon: o.lexicon });
    textBox.appendChild(p.el);
    const shown = displayTokens(p.tokens, settings.sandhi);
    shown.forEach((t: Token, i) => {
      if (t.kind !== 'han') return;
      rows.push({ word: t.text, syllables: t.pinyin ?? [], reading: p.tokens[i]?.pinyin,
        prev: shown[i - 1]?.text, next: shown[i + 1]?.text });
    });
  }

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
    ctx.toast(ok ? 'Copied' : 'Could not copy. Select the text and press Ctrl+C.', { ms: 1600 });
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
    ? h('button.icon-btn.pp-speak', { onclick: (e: Event) => playToggle(e.currentTarget as HTMLElement), title: 'Read aloud (P)', 'aria-label': 'Read aloud' }, icon('speaker'))
    : null;
  const copyBtn = h('button.icon-btn.pp-copy', { onclick: (e: Event) => void copy(e.currentTarget as HTMLElement), title: 'Copy text', 'aria-label': 'Copy text' }, icon('copy'));
  const closeBtn = h('button.icon-btn.pp-close', { onclick: () => host.close(), title: 'Close (Esc)', 'aria-label': 'Close' }, icon('close'));

  const head = h('header.pp-head', null,
    o.onBack ? h('button.icon-btn.pp-back', { onclick: () => o.onBack!(), title: 'Back', 'aria-label': 'Back' }, icon('arrowLeft')) : null,
    h('div.pp-title', null, h('span.pp-kind', null, 'Phrase'), h('span.pp-muted', null, `${[...o.text.replace(/\s/g, '')].length} characters`)),
    h('div.pp-head-actions', null, speakBtn, copyBtn, closeBtn),
  );

  const translation = createTranslationPanel({ ctx, text: o.text.replace(/\n+/g, '\n'), context: o.context, lexicon: o.lexicon, onResize: () => host.reposition(), hasWordList: rows.length > 0 });

  // Word by word
  const list = h('div.pp-wbw-list');
  const renderRows = (upTo: number) => {
    list.textContent = '';
    rows.slice(0, upTo).forEach((r) => {
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
        `Show all ${rows.length} words`));
    }
  };
  renderRows(MAX_ROWS);

  // A short selection that is not a word yet can become one (a name the detector missed).
  const hanOnly = o.text.replace(/\s/g, '');
  const addWord = o.bookId && /^\p{Script=Han}{2,8}$/u.test(hanOnly)
    ? addWordControl(
      { ctx, bookId: o.bookId, lexicon: o.lexicon, onLexiconChange: o.onLexiconChange, close: () => host.close(), reposition: () => host.reposition() },
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
        h('button.btn.btn-sm', { type: 'button', title: 'Start at this selection and continue to the end of the chapter',
          onclick: () => { host.close(); o.onReadFromHere!(); } }, icon('play'), 'Read from here')) : null,
      addWord,
      rows.length ? h('section.pp-wbw-sec', null,
        h('span.pp-section', null, 'Word by word'),
        h('p.pp-wbw-note.muted', null, 'The first dictionary meaning of each word, which may not be the one used here. Tap a word for all of them.'),
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
