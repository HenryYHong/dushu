// The name check in the reader (core/nameCandidates.ts, ARCHITECTURE.md §4.13): once a book's names have been found, a small card
// at the bottom of the page asks "Names in this book?" with the strings the book repeats that look like names, each a chip with its
// count. A tap marks one as a name (a person; a long press, a right click or its menu picks Place or Other name), × says it is not;
// Done (or Close) saves the answers as fixes of the book (core/fixes.ts), so they sync, show under Corrections and come with Undo. A
// dictionary word said not to be a name is kept on the book instead (it changes nothing on the page) and listed under Corrections
// too. Asked once per book; the Corrections tab's "Check names" asks again.
import type { AppContext, BookMeta, Dictionary, Fix, LexiconEntry } from '../../types';
import { makeFix } from '../../core/fixes';
import { DETECTOR_VERSION, pinyinOf } from '../../core/lexicon';
import { findNameCandidates, NAME_CHECK_VERSION, type NameCandidate } from '../../core/nameCandidates';
import { h } from '../dom';
import { icon } from '../icons';
import { saveWithUndo } from '../popup/fixView';
import type { BookFixes } from './bookFixes';

/** What the book keeps of the name check: the card answered or not, the candidates found, the dictionary words said not to be
 * names (水生: "not one word" would not be true of them). */
export type NameCheckState = NonNullable<BookMeta['nameCheck']>;

type Role = 'name' | 'place' | 'term';
const ROLE_LABEL: Record<Role, string> = { name: 'Person', place: 'Place', term: 'Other name' };
const LONG_PRESS_MS = 500;

export interface NameCheck {
  /** The candidates to ask about now: found once (in idle slices) and kept on the book, less what the reader has answered.
   * `fresh`: found again (Check names), so the answers make room for others. */
  candidates(fresh?: boolean): Promise<NameCandidate[]>;
  /** Not asked yet in this book. */
  due(): boolean;
  /** Shows the card at the bottom of `root` (nothing when `list` is empty). `onClose` runs when it goes away. */
  show(root: HTMLElement, list: NameCandidate[], onClose?: () => void): HTMLElement | null;
  /** Takes the card away, if it is up. */
  hide(): void;
  /** The dictionary words the reader said are not names (水生), which are not asked about again. */
  notNames(): string[];
  /** Asks about a word of notNames() again (its row under Corrections was deleted). */
  askAgain(word: string): Promise<void>;
}

/** The paragraphs and quotes of each chapter, one string per chapter (what name detection reads). */
async function chapterTexts(ctx: AppContext, book: BookMeta): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < book.chapterCount; i++) {
    const c = await ctx.store.books.chapter(book.id, i);
    out.push((c?.blocks ?? []).flatMap((b) => ((b.t === 'p' || b.t === 'quote') && b.text ? [b.text] : [])).join('\n'));
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * The name check of the open book. `found` gives the book's names and terms as detection and the store have them (before the
 * fixes); `shown` turns a word into the script the page shows.
 */
export function createNameCheck(ctx: AppContext, book: BookMeta, dict: Dictionary, fixes: BookFixes, found: () => LexiconEntry[], shown: (s: string) => string = (s) => s): NameCheck {
  let state: NameCheckState | undefined = book.nameCheck?.v === NAME_CHECK_VERSION ? book.nameCheck : undefined;
  let running: Promise<NameCandidate[]> | null = null;
  let card: HTMLElement | null = null;
  let closeCard: (() => void) | null = null;

  const keep = async (patch: Partial<NameCheckState>) => {
    state = { v: NAME_CHECK_VERSION, dv: DETECTOR_VERSION, asked: false, ...state, ...patch };
    try { await ctx.store.books.update(book.id, { nameCheck: state }); book.nameCheck = state; } catch (e) { console.error('Could not keep the name check', e); }
  };

  /** Words the reader has answered for already, or that the book has as a name or a word now. */
  const answered = (): Set<string> => {
    const out = new Set<string>(state?.no ?? []);
    for (const f of fixes.fixes()) if (!f.at && f.kind !== 'reading' && f.kind !== 'spelling') out.add(f.word);
    for (const e of found()) out.add(e.word);
    return out;
  };

  const find = async (fresh: boolean): Promise<NameCandidate[]> => {
    if (!fresh && state?.words && state.dv === DETECTOR_VERSION) return state.words.map((w) => ({ ...w, why: 'repeat', score: 0 }));
    const texts = await chapterTexts(ctx, book);
    const taken = new Set<string>([...answered()]);
    const list = await findNameCandidates(texts, dict, taken, found(), 10);
    await keep({ dv: DETECTOR_VERSION, words: list.map((c) => ({ word: c.word, count: c.count, kind: c.kind })) });
    return list;
  };

  return {
    async candidates(fresh = false) {
      running ??= find(fresh).finally(() => { running = null; });
      const list = await running;
      const done = answered();
      return list.filter((c) => !done.has(c.word));
    },
    due: () => !state?.asked,
    hide() { closeCard?.(); },
    notNames: () => [...(state?.no ?? [])],
    async askAgain(word) { await keep({ no: (state?.no ?? []).filter((w) => w !== word) }); },
    show(root, list, onClose) {
      closeCard?.();
      if (!list.length) return null;
      const picks = new Map<string, { state: 'yes' | 'no' | ''; role: Role }>(list.map((c) => [c.word, { state: '', role: c.kind === 'place' ? 'place' : 'name' }]));
      let menu: HTMLElement | null = null;
      /** The click that ends a long press is swallowed: the menu opening moves the chips, so it would land on another one. */
      let quietUntil = 0;
      const closeMenu = () => { menu?.remove(); menu = null; };

      const chip = (c: NameCandidate): HTMLElement => {
        const pick = picks.get(c.word)!;
        const word = shown(c.word);
        const label = h('span.rd-nc-kind');
        const main = h('button.rd-nc-word', { type: 'button', 'aria-pressed': 'false', title: 'Tap if this is a name. Press and hold to choose what kind.' },
          h('span.rd-nc-check', { 'aria-hidden': 'true' }, icon('check')),
          h('span.rd-nc-text.zh', null, word),
          h('span.rd-nc-count', null, `${c.count.toLocaleString('en-US')}×`), label) as HTMLButtonElement;
        const kind = h('button.rd-nc-more', { type: 'button', 'aria-label': `What kind of name ${word} is`, 'aria-haspopup': 'menu', title: 'What kind of name' }, icon('chevronDown')) as HTMLButtonElement;
        const no = h('button.rd-nc-no', { type: 'button', 'aria-pressed': 'false', 'aria-label': `${word} is not a name`, title: 'Not a name' }, icon('close')) as HTMLButtonElement;
        const el = h('div.rd-nc-chip', { role: 'group', 'aria-label': word }, main, kind, no);
        const paint = () => {
          el.dataset.state = pick.state;
          main.setAttribute('aria-pressed', String(pick.state === 'yes'));
          no.setAttribute('aria-pressed', String(pick.state === 'no'));
          label.textContent = pick.state === 'yes' ? ROLE_LABEL[pick.role] : '';
          kind.hidden = pick.state !== 'yes';
          main.setAttribute('aria-label', `${word}, ${c.count} places${pick.state === 'yes' ? `, marked as ${ROLE_LABEL[pick.role].toLowerCase()}` : pick.state === 'no' ? ', not a name' : ''}`);
          paintDone();
        };
        const openMenu = (byPress = false) => {
          closeMenu();
          pick.state = 'yes';
          paint();
          if (byPress) quietUntil = Date.now() + 1000;
          menu = h('div.rd-nc-menu', { role: 'menu', 'aria-label': `${word} is` }, ...(['name', 'place', 'term'] as Role[]).map((r) =>
            h('button.rd-nc-menu-item', { type: 'button', role: 'menuitemradio', 'aria-checked': String(r === pick.role), onclick: () => {
              pick.role = r; closeMenu(); paint(); kind.focus({ preventScroll: true });
            } }, ROLE_LABEL[r])));
          // A row of its own right after the chip, inside the card (a menu floating over it would run off a small card).
          menu.dataset.for = c.word;
          menu.addEventListener('keydown', (e) => {
            const key = (e as KeyboardEvent).key;
            if (key === 'Escape') { e.stopPropagation(); closeMenu(); kind.focus(); return; }
            // The arrows move between the kinds, as in any menu.
            const items = [...menu!.querySelectorAll<HTMLElement>('.rd-nc-menu-item')];
            const at = items.indexOf(document.activeElement as HTMLElement);
            const to = key === 'ArrowRight' || key === 'ArrowDown' ? at + 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? at - 1
              : key === 'Home' ? 0 : key === 'End' ? items.length - 1 : null;
            if (to === null) return;
            e.preventDefault();
            items[(to + items.length) % items.length].focus();
          });
          el.after(menu);
          menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
        };
        // A long press picks the kind (and marks it); a tap marks it as a person, or takes the mark away.
        let timer = 0;
        let longPressed = false;
        /** A pointer is down on the chip, and whether it is a mouse. */
        let held = false;
        let mouse = false;
        main.addEventListener('pointerdown', (e) => {
          longPressed = false;
          window.clearTimeout(timer);
          if ((e.button ?? 0) > 0) return;
          held = true;
          mouse = e.pointerType === 'mouse';
          timer = window.setTimeout(() => { longPressed = true; openMenu(true); }, LONG_PRESS_MS);
        });
        const cancel = () => { window.clearTimeout(timer); held = false; };
        main.addEventListener('pointerup', () => { const pressed = longPressed && held; cancel(); if (pressed) quietUntil = Date.now() + 400; });
        main.addEventListener('pointerleave', cancel);
        main.addEventListener('pointercancel', cancel);
        // A right click opens the menu at once, and the next click counts. A finger held down (Android says so with this event too)
        // is a long press: the click it ends in is swallowed.
        main.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (longPressed) return;
          if (held && !mouse) { window.clearTimeout(timer); longPressed = true; openMenu(true); } else openMenu();
        });
        main.addEventListener('click', () => {
          if (longPressed) { longPressed = false; return; }
          closeMenu();
          pick.state = pick.state === 'yes' ? '' : 'yes';
          paint();
        });
        kind.addEventListener('click', () => { if (menu?.dataset.for === c.word) closeMenu(); else openMenu(); });
        no.addEventListener('click', () => { closeMenu(); pick.state = pick.state === 'no' ? '' : 'no'; paint(); });
        paint();
        return el;
      };

      const doneBtn = h('button.btn.btn-sm.btn-primary.rd-nc-done', { type: 'button' }, 'Done') as HTMLButtonElement;
      function paintDone() {
        const n = [...picks.values()].filter((p) => p.state).length;
        doneBtn.textContent = n ? 'Done' : 'Not now';
        doneBtn.classList.toggle('btn-primary', n > 0);
      }
      const box = h('div.rd-coach.rd-name-ask', { role: 'dialog', 'aria-label': 'Names in this book?', 'data-rd-ui': '' },
        h('div.rd-nc-head', null,
          h('div', null,
            h('p.rd-nc-title', null, 'Names in this book?'),
            h('p.rd-nc-help', null, 'Tap the ones that are names. Tap × on any that are not.')),
          h('button.icon-btn.rd-nc-close', { type: 'button', 'aria-label': 'Close', title: 'Close', onclick: () => finish(true) }, icon('close'))),
        h('div.rd-nc-chips', null, ...list.map(chip)),
        h('div.rd-nc-foot', null, h('span.rd-nc-note', null, 'Change them later under Corrections.'), doneBtn));
      doneBtn.addEventListener('click', () => finish(true));
      box.addEventListener('click', (e) => { if (Date.now() < quietUntil) { quietUntil = 0; e.stopPropagation(); e.preventDefault(); } }, true);
      paintDone();

      const onDocDown = (e: PointerEvent) => { if (menu && !menu.contains(e.target as Node)) closeMenu(); };
      document.addEventListener('pointerdown', onDocDown, true);
      const remove = () => {
        document.removeEventListener('pointerdown', onDocDown, true);
        box.remove();
        if (card === box) { card = null; closeCard = null; }
        onClose?.();
      };
      /** Saves what was marked (Done, Close); `save` false drops it. */
      async function finish(save: boolean) {
        remove();
        const no = [...(state?.no ?? [])];
        const newNo: string[] = [];
        const out: Fix[] = [];
        let yes = 0;
        let places = 0;
        if (save) {
          for (const c of list) {
            const p = picks.get(c.word)!;
            if (p.state === 'yes') {
              out.push(makeFix({ book: fixes.book.key, bookId: fixes.book.id, kind: 'word', word: c.word, role: p.role, pinyin: pinyinOf(c.word, p.role, dict), n: c.count }));
              yes++;
              places += c.count;
            } else if (p.state === 'no') {
              // Not a name: the page keeps it as it is. A string the dictionary lacks is "not one word" in this book (a fix, synced);
              // a dictionary word is only kept from being asked again.
              if (dict.hasWord(dict.toSimplified(c.word))) { if (!no.includes(c.word)) { no.push(c.word); newNo.push(c.word); } }
              else out.push(makeFix({ book: fixes.book.key, bookId: fixes.book.id, kind: 'unword', word: c.word }));
            }
          }
        }
        await keep({ asked: true, no });
        if (!out.length && !newNo.length) return;
        const notNames = out.length - yes + newNo.length;
        const said = yes
          ? `Marked ${plural(yes, 'name')} (${plural(places, 'place')})${notNames ? `, and ${plural(notNames, 'word')} as not a name` : ''}.`
          : `${plural(notNames, 'word')} marked as not a name.`;
        // (Undo also asks about the dictionary words again.)
        const undoNo = () => { if (newNo.length) void keep({ no: (state?.no ?? []).filter((w) => !newNo.includes(w)) }); };
        if (out.length) await saveWithUndo(ctx, fixes, out, said, undoNo);
        else ctx.toast(said, { ms: 7000, action: { label: 'Undo', run: undoNo } });
      }
      card = box;
      closeCard = () => remove();
      root.appendChild(box);
      return box;
    },
  };
}
