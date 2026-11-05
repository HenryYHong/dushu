// Fixing a word from its card (ARCHITECTURE.md §4.12): the Fix sheet behind the word card's pencil (split the word, join it with the
// word before or after, change a character's reading, mark it as a name), and the phrase card's "Join as one word…" and
// "Mark as a name…". The reader saves a fix (Fixer) and draws the page again; a toast says what changed and offers Undo.
import type { AppContext, Dictionary, Fix, FixAnchor, LexiconEntry } from '../../types';
import { cutWord, makeFix } from '../../core/fixes';
import { capitalizePinyin, entryPinyinProblem, parseEntryPinyin, pinyinOf } from '../../core/lexicon';
import { formatSyllable, markedToNumbered } from '../../core/pinyin';
import { entriesForReading } from '../../core/reading';
import { h } from '../dom';
import { icon } from '../icons';
import { leadGloss } from './defs';
import type { PopupHost } from './host';
import { pinyinSpans } from './pinyinText';

/** A word on the page: as the book spells it (`word`), as the page shows it, and the reading shown. */
export interface FixPiece { word: string; shown: string; pinyin: string[] }

/** The word a card is about, its neighbors in the paragraph (Han words touching it), and where it is. */
export interface FixTarget extends FixPiece {
  prev?: FixPiece;
  next?: FixPiece;
  /** Where it is in the stored book, for "Here only". Absent when the card is not about one place. */
  at?: FixAnchor;
  /** The page cuts across its first or last character here (a selection that starts or ends inside a word). */
  crosses?: boolean;
}

/** What the reader lends a card to save fixes with. */
export interface Fixer {
  /** The open book: its id here and its key. */
  book: { id: string; key: string };
  /** Places `word` (as the book spells it) is in the book. */
  places(word: string): Promise<number>;
  /** Saves a fix (and draws the page again); resolves with the fix it replaced, for Undo. */
  save(fix: Fix): Promise<Fix | undefined>;
  remove(id: string): Promise<void>;
  /** The book's fixes now. */
  fixes(): readonly Fix[];
}

export interface FixEnv { fixer: Fixer; target: FixTarget }

type Role = LexiconEntry['kind'];
const ROLE_NAME: Record<Role, string> = { name: 'a person', place: 'a place', term: 'a name', user: 'one word' };
const cp = (s: string) => [...s];
const places = (n: number) => `${n.toLocaleString('en-US')} place${n === 1 ? '' : 's'}`;

/**
 * Saves `fix` (or several, as one change) and says so with Undo (which puts back the fixes they replaced, or takes them away, and
 * runs `onUndo`).
 */
export async function saveWithUndo(ctx: AppContext, fixer: Fixer, fix: Fix | Fix[], said: string, onUndo?: () => void): Promise<boolean> {
  const list = Array.isArray(fix) ? fix : [fix];
  const was: (Fix | undefined)[] = [];
  try { for (const f of list) was.push(await fixer.save(f)); } catch (e) {
    ctx.toast(e instanceof Error ? e.message : 'Could not save that.');
    return false;
  }
  ctx.toast(said, {
    ms: 7000,
    action: { label: 'Undo', run: () => { onUndo?.(); void Promise.all(list.map((f, k) => { const w = was[k]; return w ? fixer.save(w) : fixer.remove(f.id); })).catch(() => {}); } },
  });
  return true;
}

/**
 * The two scope buttons; the second learns its count of places when the book has been counted. `upTo`: the count is of the word in
 * the text, and the fix acts only where the page shows the word whole (掌柜 inside 掌柜的 stays), so it is said as "up to".
 */
function scopeButtons(fixer: Fixer, word: string, o: { here: boolean; hereLabel?: string; everyLabel?: string; upTo?: boolean }, go: (where: 'here' | 'book') => void): { el: HTMLElement; enable(on: boolean): void } {
  const every = o.everyLabel ?? 'Everywhere in this book';
  const bookBtn = h('button.btn.pp-fix-go', { type: 'button', onclick: () => go('book') }, every) as HTMLButtonElement;
  const hereBtn = o.here ? h('button.btn.pp-fix-go', { type: 'button', onclick: () => go('here') }, o.hereLabel ?? 'Here only') as HTMLButtonElement : null;
  void fixer.places(word).then((n) => { if (n > 0) bookBtn.textContent = `${every} (${o.upTo && n > 1 ? 'up to ' : ''}${places(n)})`; }, () => {});
  return {
    el: h('div.pp-fix-scope', null, hereBtn, bookBtn),
    enable(on) { bookBtn.disabled = !on; if (hereBtn) hereBtn.disabled = !on; },
  };
}

/** The meaning of a word from the dictionary for a reading, or ''. */
function glossOf(dict: Dictionary, shown: string, syl: readonly string[]): string {
  return leadGloss(entriesForReading(dict.lookup(shown), [...syl], shown), shown) || '';
}

/** Numbered syllables of `word` for a name of kind `role`, written for a person to read and edit (Guō Jìng). */
function nameInput(dict: Dictionary, word: string, role: Role): string {
  const syl = pinyinOf(word, role, dict).split(' ').filter(Boolean).map((s) => formatSyllable(s, 'marks'));
  return capitalizePinyin(syl, role === 'term' ? 'name' : role, word, (s) => dict.toSimplified(s));
}

const field = (label: string, input: HTMLElement, hint?: string) =>
  h('label.pp-field', null, h('span.pp-field-label', null, label), input, hint ? h('span.pp-field-hint', null, hint) : null);

/** A row of choices, one pressed (Word, Person, Place, Other name). */
function chips<T extends string>(label: string, items: [T, string][], value: T, onPick: (v: T) => void): HTMLElement {
  const row = h('div.pp-fix-chips', { role: 'radiogroup', 'aria-label': label });
  const paint = (v: T) => row.querySelectorAll<HTMLElement>('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
  for (const [v, text] of items) {
    row.appendChild(h('button.pp-fix-chip', { type: 'button', role: 'radio', 'data-v': v, onclick: () => { paint(v); onPick(v); } }, text));
  }
  paint(value);
  return row;
}

/**
 * The Fix sheet for the word a card shows. `back` returns to the card. Saving closes the popup (the page underneath is drawn
 * again) and shows a toast with Undo.
 */
export function mountFixView(host: PopupHost, ctx: AppContext, dict: Dictionary, env: FixEnv, back: () => void): void {
  const { fixer, target: t } = env;
  const style = () => ctx.settings.get().pinyinStyle;
  const book = fixer.book;
  const n = cp(t.word).length;

  const done = async (fix: Fix, said: string) => {
    if (await saveWithUndo(ctx, fixer, fix, said)) host.close();
  };
  const make = (o: Omit<Fix, 'id' | 't' | 'on' | 'book' | 'bookId'>, where: 'here' | 'book', at?: FixAnchor) =>
    makeFix({ ...o, book: book.key, bookId: book.id, ...(where === 'here' && at ? { at } : {}) });

  // ---- what is fixed already: this word everywhere, or this place
  const mine = fixer.fixes().filter((f) => f.book !== '*' && f.kind !== 'spelling'
    && (f.at ? !!t.at && f.at.chapter === t.at.chapter && f.at.block === t.at.block && f.at.offset <= t.at.offset && f.at.offset + f.word.length >= t.at.offset + t.word.length : f.word === t.word));
  const KIND_SAID: Record<Fix['kind'], string> = { word: 'Joined', unword: 'Not a word', cut: 'Split', reading: 'Reading', spelling: 'Spelling' };
  const already = mine.length ? h('section.pp-fix-have', null,
    h('span.pp-section', null, 'Your corrections'),
    ...mine.map((f) => h('div.pp-fix-have-row', null,
      h('span.zh', null, f.word === t.word ? t.shown : f.word),
      h('span.pp-muted', null, `${f.kind === 'word' && f.role && f.role !== 'user' ? (f.role === 'name' ? 'Person' : f.role === 'place' ? 'Place' : 'Name') : KIND_SAID[f.kind]}, ${f.at ? 'here' : 'everywhere'}`),
      h('button.btn.btn-sm.pp-fix-undo', { type: 'button', onclick: () => {
        void fixer.remove(f.id).then(() => { host.close(); ctx.toast(`Your correction of ${f.word === t.word ? t.shown : f.word} is deleted.`, { ms: 7000, action: { label: 'Undo', run: () => { void fixer.save(f).catch(() => {}); } } }); },
          (e) => ctx.toast(e instanceof Error ? e.message : 'Could not remove that.'));
      } }, 'Remove')))) : null;

  // ---- the sections; one is open at a time
  const sections: { row: HTMLButtonElement; panel: HTMLElement; build: () => HTMLElement }[] = [];
  const list = h('div.pp-fix-list');
  const section = (label: string, preview: string, build: () => HTMLElement, isZh = false) => {
    const panel = h('div.pp-fix-panel', { hidden: true });
    const row = h('button.pp-fix-row', { type: 'button', 'aria-expanded': 'false' },
      h('span.pp-fix-row-label', null, label),
      h(`span.pp-fix-row-preview${isZh ? '.zh' : ''}`, null, preview),
      icon('chevronDown')) as HTMLButtonElement;
    const s = { row, panel, build };
    row.addEventListener('click', () => {
      const open = row.getAttribute('aria-expanded') !== 'true';
      for (const x of sections) { x.row.setAttribute('aria-expanded', 'false'); x.panel.hidden = true; x.panel.replaceChildren(); }
      if (open) {
        row.setAttribute('aria-expanded', 'true');
        panel.replaceChildren(build());
        panel.hidden = false;
      }
      host.reposition();
      // The open section's end (its Here only and Everywhere buttons) is scrolled into the card's view.
      if (open) requestAnimationFrame(() => {
        const box = host.scroller;
        const end = panel.getBoundingClientRect().bottom - box.getBoundingClientRect().top + box.scrollTop + 8;
        if (end > box.scrollTop + box.clientHeight) box.scrollTop = end - box.clientHeight;
      });
    });
    sections.push(s);
    list.append(row, panel);
  };

  // Split: tap the gaps between the characters.
  if (n >= 2) {
    section('Split', cp(t.shown).join(' | '), () => {
      const chars = cp(t.shown);
      const cuts = new Set<number>();
      const preview = h('div.pp-fix-pieces');
      const strip = h('div.pp-fix-strip.zh', { role: 'group', 'aria-label': 'Where to split' });
      const scope = scopeButtons(fixer, t.word, { here: !!t.at, upTo: true }, (where) => {
        const at = [...cuts].sort((a, b) => a - b);
        const pieces = cutWord(t.shown, at);
        void done(make({ kind: 'cut', word: t.word, cuts: at }, where, t.at),
          where === 'here' ? `${t.shown} is split here: ${pieces.join(' ')}.` : `${t.shown} is split into ${pieces.join(' ')} everywhere in this book.`);
      });
      const paint = () => {
        preview.replaceChildren();
        const pieces = cutWord(t.shown, [...cuts]);
        pieces.forEach((p, k) => {
          const py = dict.pinyinFor(p, { prev: k ? pieces[k - 1] : t.prev?.shown, next: pieces[k + 1] ?? t.next?.shown });
          preview.appendChild(h('div.pp-fix-piece', null, h('span.pp-fix-piece-word.zh', null, p), pinyinSpans(ctx, py),
            h('span.pp-fix-piece-gloss', null, glossOf(dict, p, py) || dict.char(p)?.definition.split(';')[0] || '')));
        });
        scope.enable(cuts.size > 0);
      };
      chars.forEach((ch, i) => {
        if (i > 0) {
          const gap = h('button.pp-fix-gap', { type: 'button', 'aria-pressed': 'false', 'aria-label': `Split before ${ch}` }, h('span.pp-fix-gap-line')) as HTMLButtonElement;
          gap.addEventListener('click', () => {
            if (cuts.has(i)) cuts.delete(i); else cuts.add(i);
            gap.setAttribute('aria-pressed', String(cuts.has(i)));
            paint();
          });
          strip.appendChild(gap);
        }
        strip.appendChild(h('span.pp-fix-ch', null, ch));
      });
      paint();
      return h('div.pp-fix-body', null, h('p.pp-fix-help', null, 'Tap between the characters where the words end.'), strip, preview, scope.el);
    }, true);
  }

  // Join with the word before or after.
  const joinSection = (side: 'prev' | 'next', other: FixPiece) => {
    const word = side === 'prev' ? other.word + t.word : t.word + other.word;
    const shown = side === 'prev' ? other.shown + t.shown : t.shown + other.shown;
    section(side === 'prev' ? 'Join with previous' : 'Join with next', shown, () => {
      const inDict = dict.hasWord(shown);
      const parts = side === 'prev' ? [...other.pinyin, ...t.pinyin] : [...t.pinyin, ...other.pinyin];
      let py = inDict ? dict.pinyinFor(shown, {}) : parts;
      if (py.length !== cp(word).length || !py.every(Boolean)) py = parts;
      let role: Role = 'user';
      const pyLine = h('div.pp-fix-joined-py');
      const paintPy = () => pyLine.replaceChildren(pinyinSpans(ctx, role === 'user' ? py : pinyinOf(word, role, dict).split(' '), { kind: role, word }));
      paintPy();
      const gloss = inDict ? glossOf(dict, shown, py) : '';
      const meaning = h<'input'>('input.input', { type: 'text', autocomplete: 'off', placeholder: 'Optional', 'aria-label': 'Meaning' });
      const scope = scopeButtons(fixer, word, { here: !!t.at, upTo: role === 'user' }, (where) => {
        const pinyin = role === 'user' ? py.join(' ') : pinyinOf(word, role, dict);
        const g = meaning.value.trim() || (role === 'user' ? gloss : '');
        void done(make({ kind: 'word', word, pinyin, role, ...(g ? { gloss: g } : {}) }, where, t.at ? joinedAnchor(t.at, side, other) : undefined),
          role === 'user'
            ? (where === 'here' ? `${shown} is one word here.` : `${shown} is one word everywhere in this book.`)
            : `${shown} is marked as ${ROLE_NAME[role]}${where === 'here' ? ' here' : ' in this book'}.`);
      });
      return h('div.pp-fix-body', null,
        h('div.pp-fix-joined', null, h('span.pp-word-big.zh', null, shown), pyLine),
        gloss ? h('p.pp-fix-gloss', null, gloss) : field('Meaning', meaning),
        chips<Role>('What it is', [['user', 'Word'], ['name', 'Person'], ['place', 'Place'], ['term', 'Other name']], role, (v) => { role = v; paintPy(); }),
        scope.el);
    }, true);
  };
  if (t.prev) joinSection('prev', t.prev);
  if (t.next) joinSection('next', t.next);

  // Reading: each character's readings as chips.
  section('Reading', t.pinyin.map((s) => formatSyllable(s, style())).join(' '), () => {
    const chosen = [...t.pinyin];
    const book = cp(t.word);
    const scope = scopeButtons(fixer, t.word, { here: !!t.at, upTo: true }, (where) => {
      const shown = chosen.map((s) => formatSyllable(s, 'marks')).join(' ');
      void done(make({ kind: 'reading', word: t.word, pinyin: chosen.join(' ') }, where, t.at),
        where === 'here' ? `${t.shown} reads ${shown} here.` : `${t.shown} reads ${shown} everywhere in this book.`);
    });
    scope.enable(false);
    const grid = h('div.pp-fix-reads');
    cp(t.shown).forEach((ch, i) => {
      const options = readingsOf(dict, book[i] ?? ch, t.pinyin[i]);
      const row = h('div.pp-fix-read', null, h('span.pp-fix-ch.zh', null, ch));
      const box = h('div.pp-fix-chips', { role: 'radiogroup', 'aria-label': `Reading of ${ch}` });
      const paint = () => box.querySelectorAll<HTMLElement>('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === chosen[i])));
      for (const syl of options) {
        box.appendChild(h('button.pp-fix-chip.pp-fix-chip-py', { type: 'button', role: 'radio', 'data-v': syl, onclick: () => {
          chosen[i] = syl;
          paint();
          scope.enable(chosen.some((s, k) => s !== t.pinyin[k]));
        } }, formatSyllable(syl, style())));
      }
      paint();
      row.appendChild(box);
      grid.appendChild(row);
    });
    return h('div.pp-fix-body', null, grid, scope.el);
  });

  // It's a name: a person, a place or another name, everywhere in the book. (One character alone is no word of the book: join it with
  // the character beside it instead.)
  if (n >= 2) section("It's a name", 'Person, place or other', () => nameForm(ctx, dict, fixer, { word: t.word, shown: t.shown }, (fix, said) => void done(fix, said)));

  host.content.replaceChildren(
    h('header.pp-head', null,
      h('button.icon-btn.pp-back', { type: 'button', onclick: back, title: 'Back', 'aria-label': 'Back' }, icon('arrowLeft')),
      h('div.pp-title', null, h('span.pp-kind', null, 'Fix'), h('span.pp-word.pp-fix-word.zh', null, t.shown)),
      h('div.pp-head-actions', null, h('button.icon-btn.pp-close', { type: 'button', onclick: () => host.close(), title: 'Close (Esc)', 'aria-label': 'Close' }, icon('close')))),
    h('div.pp-body.pp-fix', null, already, list),
  );
  host.scroller.scrollTop = 0;
  host.focus();
  host.placeNow();
}

/** The anchor of the word joined with its neighbor: with the word before, it starts where that word starts. */
function joinedAnchor(at: FixAnchor, side: 'prev' | 'next', other: FixPiece): FixAnchor {
  if (side === 'next') return { ...at, after: cp(at.after).slice(cp(other.word).length).join('') };
  const before = cp(at.before);
  return { ...at, offset: at.offset - other.word.length, before: before.slice(0, Math.max(0, before.length - cp(other.word).length)).join('') };
}

/** The readings a character can have, numbered: the dictionary's, the one shown, and the one shown without its tone. */
export function readingsOf(dict: Dictionary, ch: string, current?: string): string[] {
  const out: string[] = [];
  const add = (s: string | undefined) => { const v = s?.toLowerCase(); if (v && /^[a-zü]+[1-5]$/.test(v) && !out.includes(v)) out.push(v); };
  for (const e of dict.lookup(ch)) if (!/\s/.test(e.pinyin.trim())) add(e.pinyin.trim());
  for (const r of dict.char(ch)?.readings ?? []) add(markedToNumbered(r));
  add(current);
  if (current && !current.endsWith('5')) add(current.replace(/[1-4]$/, '5'));
  return out.slice(0, 8);
}

/** The "It's a name" form: Person, Place or Other name, the pinyin to edit (surname readings and capitals), an optional meaning. */
function nameForm(ctx: AppContext, dict: Dictionary, fixer: Fixer, w: { word: string; shown: string }, save: (fix: Fix, said: string) => void): HTMLElement {
  let role: Role = 'name';
  let edited = false;
  const py = h<'input'>('input.input', { type: 'text', value: nameInput(dict, w.word, role), autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Pinyin' });
  py.addEventListener('input', () => { edited = true; });
  const meaning = h<'input'>('input.input', { type: 'text', autocomplete: 'off', placeholder: 'Optional', 'aria-label': 'Meaning' });
  const err = h('p.pp-field-error', { role: 'alert' });
  const scope = scopeButtons(fixer, w.word, { here: false, everyLabel: 'Mark in this book' }, () => {
    const parsed = parseEntryPinyin(py.value, w.word);
    if (!parsed) {
      err.textContent = entryPinyinProblem(py.value, w.word);
      return;
    }
    err.textContent = '';
    void fixer.places(w.word).then((n) => {
      const g = meaning.value.trim();
      save(makeFix({ book: fixer.book.key, bookId: fixer.book.id, kind: 'word', word: w.word, pinyin: parsed, role, ...(g ? { gloss: g } : {}), ...(n ? { n } : {}) }),
        `${w.shown} is marked as ${ROLE_NAME[role]}${n ? ` (${places(n)} in the book)` : ''}.`);
    }, () => {});
  });
  return h('div.pp-fix-body', null,
    chips<Role>('What kind of name', [['name', 'Person'], ['place', 'Place'], ['term', 'Other name']], role, (v) => {
      role = v;
      if (!edited) py.value = nameInput(dict, w.word, role);
    }),
    field('Pinyin', py, 'Capitals and tone marks are fine, or tone numbers like guo1 jing4'),
    field('Meaning', meaning),
    err,
    scope.el);
}

/**
 * The phrase card's two ways to fix a selection of 2 to 8 Han characters: "Join as one word…" (here only, everywhere in the book, or
 * in every book) and "Mark as a name…". Null when the selection cannot be a word.
 */
export function phraseFixControls(ctx: AppContext, dict: Dictionary, host: PopupHost, env: { fixer: Fixer; target: FixTarget }): HTMLElement | null {
  const { fixer, target: t } = env;
  const n = cp(t.word).length;
  if (n < 2 || n > 8 || !/^\p{Script=Han}+$/u.test(t.word)) return null;
  const root = h('div.pp-addword.pp-fix-phrase');
  const close = () => host.close();
  const done = async (fix: Fix | Fix[], said: string) => { if (await saveWithUndo(ctx, fixer, fix, said)) close(); };
  /** A form just opened: its end (the buttons that save) is scrolled into the card's view, and its first field takes the focus. */
  const reveal = () => {
    host.reposition();
    root.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      const box = host.scroller;
      const end = root.getBoundingClientRect().bottom - box.getBoundingClientRect().top + box.scrollTop + 8;
      if (end > box.scrollTop + box.clientHeight) box.scrollTop = end - box.clientHeight;
    });
  };
  const buttons = () => {
    root.replaceChildren(h('div.pp-fix-phrase-btns', null,
      h('button.btn.btn-sm.pp-fix-open', { type: 'button', onclick: join, title: 'Read these characters as one word' }, icon('plus'), 'Join as one word…'),
      h('button.btn.btn-sm.pp-fix-open', { type: 'button', onclick: name, title: 'This is the name of a person, a place or a thing' }, icon('user'), 'Mark as a name…')));
    host.reposition();
  };
  const cancel = h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => buttons() }, 'Cancel');
  function join() {
    const py = h<'input'>('input.input', { type: 'text', value: t.pinyin.join(' '), autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Pinyin' });
    const meaning = h<'input'>('input.input', { type: 'text', autocomplete: 'off', placeholder: 'Optional', 'aria-label': 'Meaning' });
    const err = h('p.pp-field-error', { role: 'alert' });
    const go = (where: 'here' | 'book' | 'all') => {
      const parsed = parseEntryPinyin(py.value, t.word);
      if (!parsed) { err.textContent = entryPinyinProblem(py.value, t.word); host.reposition(); return; }
      const g = meaning.value.trim();
      const all = where === 'all';
      const word = (o: { book: string; bookId: string; at?: FixAnchor }) => makeFix({ ...o, kind: 'word', word: t.word, pinyin: parsed, role: 'user', ...(g ? { gloss: g } : {}) });
      const fix = word({ book: all ? '*' : fixer.book.key, bookId: all ? '*' : fixer.book.id, ...(where === 'here' && t.at ? { at: t.at } : {}) });
      // Where the page cuts across the selection (酒店|里 for 店里), a word for the book only joins where the page shows its characters
      // as whole words: this place is joined too, so the page changes where the reader asked.
      const also = where !== 'here' && t.crosses && t.at ? [word({ book: fixer.book.key, bookId: fixer.book.id, at: t.at })] : [];
      void done([fix, ...also], where === 'here' ? `${t.shown} is one word here.` : all ? `${t.shown} is one word in all your books.` : `${t.shown} is one word everywhere in this book.`);
    };
    const scope = scopeButtons(fixer, t.word, { here: !!t.at, upTo: true }, (where) => go(where));
    root.replaceChildren(h('form.pp-lex-form', { onsubmit: (e: Event) => { e.preventDefault(); go('book'); } },
      h('div.pp-word-line', null, h('span.pp-word-big.zh', null, t.shown)),
      field('Pinyin', py, 'Tone numbers, like guo1 jing4'),
      field('Meaning', meaning),
      err,
      scope.el,
      h('div.pp-fix-scope', null,
        h('button.btn.btn-ghost.pp-fix-go', { type: 'button', onclick: () => go('all') }, 'In all my books'),
        cancel)));
    reveal();
  }
  function name() {
    root.replaceChildren(h('div.pp-lex-form', null,
      h('div.pp-word-line', null, h('span.pp-word-big.zh', null, t.shown)),
      nameForm(ctx, dict, fixer, { word: t.word, shown: t.shown }, (fix, said) => void done(fix, said)),
      h('div.pp-fix-scope', null, cancel)));
    reveal();
  }
  buttons();
  return root;
}
