// The keyboard shortcuts, in one place so the reader's sheet and the About page cannot drift apart.
// Keep this in step with the key handlers in ui/reader/reader.ts, ui/popup/host.ts and ui/review/review.ts.
import { h } from './dom';
import { icon } from './icons';
import { isChinese } from '../lang/active';
import { aidWord, levelScheme } from '../lang/labels';
import { tt, ttm } from '../i18n';

/**
 * `keys` is one chord: its parts are pressed together ("Shift", "→" is Shift + →). A part can name alternatives
 * with " or ", or a range with " to " ("[ or ]", "1 to 4"); those are drawn as separate keys with the word between.
 * Old callers that just join the parts with " + " still read correctly. A key with a name ("Shift", "Space") is shown
 * through tt(), so it is marked with ttm() where it is listed.
 */
export interface ShortcutRow { keys: string[]; readonly what: string }
/** `key` is the group's English name, which never changes (openShortcuts' `groups` names it); `group` is what is shown. */
export interface ShortcutGroup { key: string; readonly group: string; rows: ShortcutRow[] }

// The list is built when this file loads, before the app's language may have: each name and description is read in the
// language when it is shown (a getter), so the sheet and the About page need do nothing.
const row = (keys: string[], what: string | (() => string)): ShortcutRow =>
  ({ keys, get what() { return typeof what === 'string' ? tt(what) : what(); } });
const group = (key: string, rows: ShortcutRow[]): ShortcutGroup => ({ key, get group() { return tt(key); }, rows });

export const SHORTCUTS: ShortcutGroup[] = [
  group(ttm('Reading'), [
    row([ttm('Click')], ttm('Look up a word (or hover, if you chose that)')),
    row([ttm('Double-click')], ttm('Look up a word')),
    row([ttm('Drag')], () => (isChinese() ? tt('Select a phrase or sentence for pinyin and a translation') : tt('Select a phrase or sentence for a translation'))),
    row(['P'], () => (isChinese() ? tt('Cycle pinyin: off, all, unknown, HSK') : tt('Cycle {aid}: off, all, unknown, {scheme}', { aid: aidWord(), scheme: levelScheme() }))),
    row(['[ or ]'], ttm('Smaller and larger text')),
    row(['F'], ttm('Full screen on or off')),
    row(['B'], ttm('Bookmark this page, or take its bookmark away')),
    row(['C'], ttm('Open the chapter list')),
    row(['W'], ttm('Open the words of this chapter')),
    // Only Chinese has a Names tab (the language is fixed for the page: switching reloads it).
    ...(isChinese() ? [row(['N'], ttm('Open the names and terms of this book'))] : []),
    row([ttm('Page Down')], ttm('At the end of a chapter, go to the next one')),
    row([ttm('Page Up')], ttm('At the top of a chapter, go to the previous one')),
    row([ttm('Shift'), '← or →'], ttm('Previous or next chapter, from anywhere')),
    row(['?'], ttm('Show the shortcut sheet')),
    row([ttm('Esc')], ttm('Close the open card or menu')),
  ]),
  group(ttm('In a word card'), [
    row(['← or →'], ttm('Previous or next word')),
    row([ttm('Shift'), '← or →'], ttm('Make the selection shorter or longer')),
    row(['S'], ttm('Save the word to your flashcards')),
    row(['K'], ttm('Mark the word as known')),
    row(['P'], ttm('Play the pronunciation')),
  ]),
  group(ttm('Review'), [
    row([ttm('Space')], ttm('Reveal the answer')),
    row(['1 to 4'], ttm('Again, Hard, Good, Easy')),
    row(['P'], ttm('Play the pronunciation')),
  ]),
];

/** "[ or ]", "1 to 4": the two keys and the word between, as a whole phrase a language can reorder ("1～4"). */
const JOINS: Record<string, string> = { or: ttm('{a} or {b}'), to: ttm('{a} to {b}') };
const JOINED = /^(.+?)\s(or|to)\s(.+)$/;

/** One part of a chord: a <kbd>, or the keys of "[ or ]" with the word between them in a small plain span. */
function partCaps(part: string): Node[] {
  const m = JOINED.exec(part);
  if (!m) return [h('kbd.kbd', null, tt(part))];
  const [, a, word, b] = m;
  const out: Node[] = [];
  for (const piece of tt(JOINS[word]).split(/(\{[ab]\})/)) {
    if (piece === '{a}') out.push(...partCaps(a));
    else if (piece === '{b}') out.push(...partCaps(b));
    else if (piece.trim()) out.push(h('span.sc-word', null, piece.trim()));
  }
  return out;
}

/** The key caps of one row, as DOM: <kbd> for each key, small plain words and "+" between them. */
export function keyCaps(row: ShortcutRow): Node[] {
  const out: Node[] = [];
  row.keys.forEach((part, i) => {
    if (i) out.push(h('span.sc-plus', { 'aria-hidden': 'true' }, '+'));
    out.push(...partCaps(part));
  });
  return out;
}

export interface OpenShortcutsOptions {
  /** Only these groups, by their English names. The reader passes ['Reading', 'In a word card']; the default is all of them. */
  groups?: string[];
}

/** The shortcut sheet: one titled section per group. The dialog itself takes focus, so Close shows no ring until Tab. */
export function openShortcuts(opts: OpenShortcutsOptions = {}): HTMLDialogElement {
  const groups = opts.groups ? SHORTCUTS.filter((g) => opts.groups!.includes(g.key)) : SHORTCUTS;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = h('dialog.modal.sc-dialog', { 'aria-labelledby': 'sc-title', tabindex: -1 }) as HTMLDialogElement;
  dialog.append(h('div.sc-body', null,
    h('div.sc-head', null,
      h('h2#sc-title', null, tt('Keyboard shortcuts')),
      h('button.icon-btn', { type: 'button', 'aria-label': tt('Close'), onclick: () => dialog.close() }, icon('close'))),
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
