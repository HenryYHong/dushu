// The keyboard shortcuts, in one place so the reader's sheet and the About page cannot drift apart.
// Keep this in step with the key handlers in ui/reader/reader.ts, ui/popup/host.ts and ui/review/review.ts.
import { h } from './dom';
import { icon } from './icons';

/**
 * `keys` is one chord: its parts are pressed together ("Shift", "→" is Shift + →). A part can name alternatives
 * with " or ", or a range with " to " ("[ or ]", "1 to 4"); those are drawn as separate keys with the word between.
 * Old callers that just join the parts with " + " still read correctly.
 */
export interface ShortcutRow { keys: string[]; what: string }
export interface ShortcutGroup { group: string; rows: ShortcutRow[] }

export const SHORTCUTS: ShortcutGroup[] = [
  {
    group: 'Reading',
    rows: [
      { keys: ['Click'], what: 'Look up a word (or hover, if you chose that)' },
      { keys: ['Double-click'], what: 'Look up a word' },
      { keys: ['Drag'], what: 'Select a phrase or sentence for pinyin and a translation' },
      { keys: ['P'], what: 'Cycle pinyin: off, all, unknown, HSK' },
      { keys: ['[ or ]'], what: 'Smaller and larger text' },
      { keys: ['F'], what: 'Full screen on or off' },
      { keys: ['B'], what: 'Bookmark this page, or take its bookmark away' },
      { keys: ['C'], what: 'Open the chapter list' },
      { keys: ['W'], what: 'Open the words of this chapter' },
      { keys: ['N'], what: 'Open the names and terms of this book' },
      { keys: ['Page Down'], what: 'At the end of a chapter, go to the next one' },
      { keys: ['Page Up'], what: 'At the top of a chapter, go to the previous one' },
      { keys: ['Shift', '← or →'], what: 'Previous or next chapter, from anywhere' },
      { keys: ['?'], what: 'Show the shortcut sheet' },
      { keys: ['Esc'], what: 'Close the open card or menu' },
    ],
  },
  {
    group: 'In a word card',
    rows: [
      { keys: ['← or →'], what: 'Previous or next word' },
      { keys: ['Shift', '← or →'], what: 'Make the selection shorter or longer' },
      { keys: ['S'], what: 'Save the word to your flashcards' },
      { keys: ['K'], what: 'Mark the word as known' },
      { keys: ['P'], what: 'Play the pronunciation' },
    ],
  },
  {
    group: 'Review',
    rows: [
      { keys: ['Space'], what: 'Reveal the answer' },
      { keys: ['1 to 4'], what: 'Again, Hard, Good, Easy' },
      { keys: ['P'], what: 'Play the pronunciation' },
    ],
  },
];

const WORD_SEP = /\s(or|to)\s/;

/** The key caps of one row, as DOM: <kbd> for each key, small plain words and "+" between them. */
export function keyCaps(row: ShortcutRow): Node[] {
  const out: Node[] = [];
  row.keys.forEach((part, i) => {
    if (i) out.push(h('span.sc-plus', { 'aria-hidden': 'true' }, '+'));
    // split() with one capture group gives [cap, 'or', cap, ...]
    part.split(WORD_SEP).forEach((piece, j) => out.push(j % 2 ? h('span.sc-word', null, piece) : h('kbd.kbd', null, piece)));
  });
  return out;
}

export interface OpenShortcutsOptions {
  /** Only these groups, by name. The reader passes ['Reading', 'In a word card']; the default is all of them. */
  groups?: string[];
}

/** The shortcut sheet: one titled section per group. The dialog itself takes focus, so Close shows no ring until Tab. */
export function openShortcuts(opts: OpenShortcutsOptions = {}): HTMLDialogElement {
  const groups = opts.groups ? SHORTCUTS.filter((g) => opts.groups!.includes(g.group)) : SHORTCUTS;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = h('dialog.modal.sc-dialog', { 'aria-labelledby': 'sc-title', tabindex: -1 }) as HTMLDialogElement;
  dialog.append(h('div.sc-body', null,
    h('div.sc-head', null,
      h('h2#sc-title', null, 'Keyboard shortcuts'),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, icon('close'))),
    groups.map((g) => h('section.sc-group', null,
      h('h3.sc-group-title', null, g.group),
      h('dl.sc-list', null, g.rows.map((r) => h('div.sc-row', null,
        h('dt', null, keyCaps(r)),
        h('dd', null, r.what))))))));
  // Closing hands focus back to whatever had it (the reader's page, or a button), not to the top of the document.
  dialog.addEventListener('close', () => { dialog.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  dialog.focus({ preventScroll: true });
  return dialog;
}
