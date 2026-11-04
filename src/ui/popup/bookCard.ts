// "In this book" card and the "Add as a word" form: names and terms the dictionary lacks. Contract: ARCHITECTURE.md §4.9.
import type { AppContext, Fix, Lexicon, LexiconEntry } from '../../types';
import { entryPinyinProblem, parseEntryPinyin, USER_SCOPE } from '../../core/lexicon';
import { makeFix } from '../../core/fixes';
import type { Fixer } from './fixView';
import { pinyinSpans } from './pinyinText';
import { h } from '../dom';
import { icon } from '../icons';

export interface BookCardEnv {
  ctx: AppContext;
  /** The open book; edits are saved in its scope. */
  bookId: string;
  lexicon?: Lexicon;
  onLexiconChange?: () => void;
  /** Close the popup (after an entry was removed or added: the text underneath is about to change). */
  close(): void;
  /** The content got taller or shorter. */
  reposition(): void;
  /** The reader's fixes (core/fixes.ts): with it, an edit, a "Not a word" and a word added are saved as fixes, which sync. */
  fixer?: Fixer;
}

/** A word fix for this book (or for every book) that says what `entry` is. */
function wordFix(fixer: Fixer, entry: LexiconEntry, all = false) {
  return makeFix({ book: all ? '*' : fixer.book.key, bookId: all ? '*' : fixer.book.id, kind: entry.enabled ? 'word' : 'unword', word: entry.word,
    ...(entry.enabled ? { pinyin: entry.pinyin, role: entry.kind, ...(entry.gloss ? { gloss: entry.gloss } : {}), ...(entry.count ? { n: entry.count } : {}) } : {}) });
}

const KIND_LABEL: Record<LexiconEntry['kind'], string> = { name: 'Person', place: 'Place', term: 'Term', user: 'Your word' };

/** Numbered pinyin as colored spans in the user's style (a name or a place with capitals). */
function pinyinLine(ctx: AppContext, entry: LexiconEntry): HTMLElement {
  return pinyinSpans(ctx, entry.pinyin.split(/\s+/).filter(Boolean), { kind: entry.kind, word: entry.word });
}

const field = (label: string, input: HTMLElement, hint?: string) =>
  h('label.pp-field', null, h('span.pp-field-label', null, label), input, hint ? h('span.pp-field-hint', null, hint) : null);

/** The card for a word that is in the book's lexicon. */
export function bookCard(env: BookCardEnv, entry: LexiconEntry): HTMLElement {
  const { ctx } = env;
  const root = h('section.pp-book');
  let current = entry;

  const draw = () => {
    root.replaceChildren(
      h('div.pp-book-head', null,
        h('span.pp-section', null, 'In this book'),
        h('span.chip.chip-accent', null, KIND_LABEL[current.kind]),
        current.count ? h('span.pp-muted', null, `${current.count.toLocaleString('en-US')} time${current.count === 1 ? '' : 's'}`) : null,
      ),
      h('div.pp-book-main', null,
        current.pinyin ? pinyinLine(ctx, current) : null,
        current.gloss ? h('span.pp-book-gloss', null, current.gloss) : null,
      ),
      h('div.pp-book-actions', null,
        h('button.btn.btn-sm', { onclick: edit }, icon('pen'), 'Edit'),
        h('button.btn.btn-sm.btn-ghost', { onclick: () => void reject(), title: 'This is not one word. Show it as separate words again.' }, 'Not a word'),
      ),
    );
    env.reposition();
  };

  const edit = () => {
    const py = h<'input'>('input.input', { type: 'text', value: current.pinyin, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Pinyin' });
    const gloss = h<'input'>('input.input', { type: 'text', value: current.gloss, autocomplete: 'off', 'aria-label': 'Meaning' });
    const err = h('p.pp-field-error', { role: 'alert' });
    const save = async () => {
      const parsed = parseEntryPinyin(py.value, current.word);
      if (!parsed) {
        err.textContent = entryPinyinProblem(py.value, current.word);
        env.reposition();
        return;
      }
      const next: LexiconEntry = { ...current, pinyin: parsed, gloss: gloss.value.trim(), origin: 'user' };
      try {
        if (env.fixer) await env.fixer.save(wordFix(env.fixer, next));
        else await ctx.store.lexicon.upsert(env.bookId, next);
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : 'Could not save that.';
        env.reposition();
        return;
      }
      current = next;
      env.onLexiconChange?.();
      draw();
    };
    const form = h('form.pp-lex-form', { onsubmit: (e: Event) => { e.preventDefault(); void save(); } },
      field('Pinyin', py, 'Tone numbers, like guo1 jing4'),
      field('Meaning', gloss),
      err,
      h('div.pp-book-actions', null,
        h('button.btn.btn-sm.btn-primary', { type: 'submit' }, 'Save'),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: draw }, 'Cancel'),
      ),
    );
    root.replaceChildren(h('div.pp-book-head', null, h('span.pp-section', null, 'Edit entry')), form);
    env.reposition();
    py.focus();
    py.select();
  };

  const reject = async () => {
    const off: LexiconEntry = { ...current, enabled: false, origin: 'user' };
    const fixer = env.fixer;
    let was: Fix | undefined;
    const fix = fixer && wordFix(fixer, off);
    try {
      if (fixer && fix) was = await fixer.save(fix);
      else await ctx.store.lexicon.upsert(env.bookId, off);
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : 'Could not save that.');
      return;
    }
    env.onLexiconChange?.();
    env.close();
    ctx.toast(`${current.word} is no longer treated as one word.`, {
      action: {
        label: 'Undo',
        run: () => {
          if (fixer && fix) void (was ? fixer.save(was) : fixer.remove(fix.id)).catch(() => {});
          else void ctx.store.lexicon.upsert(env.bookId, { ...current, enabled: true }).then(() => env.onLexiconChange?.());
        },
      },
      ms: 6000,
    });
  };

  draw();
  return root;
}

export interface AddWordOptions {
  word: string;
  /** Numbered pinyin to start from (one per code point), if known. */
  pinyin?: string;
}

/** A button that opens the "Add as a word" form in place. Returns null when the word cannot be added. */
export function addWordControl(env: BookCardEnv, o: AddWordOptions): HTMLElement | null {
  const n = [...o.word].length;
  if (n < 2 || n > 8) return null;
  if (env.lexicon?.has(o.word)) return null;
  const root = h('div.pp-addword');
  const showButton = () => {
    root.replaceChildren(h('button.btn.btn-sm', { onclick: openForm, title: 'Treat this as one word in this book, with your own pinyin and meaning' }, icon('plus'), 'Add as a word…'));
    env.reposition();
  };
  const openForm = () => {
    const py = h<'input'>('input.input', { type: 'text', value: o.pinyin ?? '', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Pinyin' });
    const gloss = h<'input'>('input.input', { type: 'text', autocomplete: 'off', placeholder: 'Optional', 'aria-label': 'Meaning' });
    const scope = h<'select'>('select.select', { 'aria-label': 'Where to use it' },
      h('option', { value: 'book' }, 'This book'),
      h('option', { value: 'all' }, 'All books'),
    );
    const err = h('p.pp-field-error', { role: 'alert' });
    const save = async () => {
      const parsed = parseEntryPinyin(py.value, o.word);
      if (!parsed) {
        err.textContent = entryPinyinProblem(py.value, o.word);
        env.reposition();
        return;
      }
      const entry: LexiconEntry = { word: o.word, pinyin: parsed, gloss: gloss.value.trim(), kind: 'user', enabled: true, origin: 'user' };
      try {
        if (env.fixer) {
          await env.fixer.save(wordFix(env.fixer, entry, scope.value === 'all'));
          // A "Not a word" of this book would hide it here: the word for every book is a word here too.
          if (scope.value === 'all' && env.fixer.fixes().some((f) => f.kind === 'unword' && f.word === o.word)) await env.fixer.save(wordFix(env.fixer, entry));
        } else {
          await env.ctx.store.lexicon.upsert(scope.value === 'all' ? USER_SCOPE : env.bookId, entry);
          // A book-level row would hide an older rejection of the same word; make sure the new one wins.
          if (scope.value === 'all') await env.ctx.store.lexicon.upsert(env.bookId, entry);
        }
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : 'Could not save that.';
        env.reposition();
        return;
      }
      env.onLexiconChange?.();
      env.close();
      env.ctx.toast(`${o.word} will now be read as one word.`, { ms: 3500 });
    };
    root.replaceChildren(h('form.pp-lex-form', { onsubmit: (e: Event) => { e.preventDefault(); void save(); } },
      h('div.pp-word-line', null, h('span.pp-word-big.zh', null, o.word)),
      field('Pinyin', py, 'Tone numbers, like guo1 jing4'),
      field('Meaning', gloss),
      field('Use in', scope),
      err,
      h('div.pp-book-actions', null,
        h('button.btn.btn-sm.btn-primary', { type: 'submit' }, 'Add'),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: showButton }, 'Cancel'),
      ),
    ));
    env.reposition();
    py.focus();
  };
  showButton();
  return root;
}
