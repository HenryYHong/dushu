// The Data group: backup export/import and "delete all data".
import type { AppContext, BackupReport } from '../../types';
import { h } from '../dom';
import { icon } from '../icons';
import { confirmDialog } from '../library/dialogs';
import { MAC_NOTE, fetchMacBooks, removedMacBooks, rememberRemoval, type MacBook } from '../library/macBooks';
import { group, row } from './controls';


export function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `dushu-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

/** "Added 12 words, updated 3, 40 known words, 2 books' progress." */
export function describeReport(r: BackupReport): string {
  const n = (k: number, one: string, many = one + 's') => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`;
  const parts: string[] = [];
  if (r.vocab.added) parts.push(`added ${n(r.vocab.added, 'saved word')}`);
  if (r.vocab.updated) parts.push(`updated ${n(r.vocab.updated, 'saved word')}`);
  if (r.known.added) parts.push(`added ${n(r.known.added, 'known word')}`);
  const prog = r.progress.added + r.progress.updated;
  if (prog) parts.push(`restored progress for ${n(prog, 'book')}`);
  if (r.progress.skipped) parts.push(`kept existing or unmatched progress for ${n(r.progress.skipped, 'book')}`);
  if (r.reviews.added) parts.push(`added ${n(r.reviews.added, 'review')}`);
  if (r.settings) parts.push('restored your settings');
  if (!parts.length) return 'Nothing new in that backup. Everything in it was already here.';
  const text = parts.join(', ');
  return text[0].toUpperCase() + text.slice(1) + '.';
}

/** The Mac's book list for the wipe, or nothing if the Mac does not answer quickly: a wipe never waits long on the Mac. */
async function quickMacList(): Promise<MacBook[]> {
  try { return (await Promise.race([fetchMacBooks(), new Promise<never>((_, no) => setTimeout(no, 2000))])).books; } catch { return []; }
}

/**
 * Removes books, words, progress, review history and every dushu.* key in localStorage. The Mac's books that were on this
 * device stay on the removed list, so a wipe does not silently bring them back: the library offers Restore.
 */
export async function eraseAllData(ctx: AppContext, macBooks?: MacBook[]): Promise<void> {
  const known = macBooks ?? await quickMacList();
  // Noted before anything is deleted: a wipe that fails halfway leaves the books and a removal note, never a lost book.
  for (const b of await ctx.store.books.list()) rememberRemoval(b, known);
  const keep = removedMacBooks();
  await ctx.store.wipe();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('dushu.')) localStorage.removeItem(k);
  } catch { /* storage blocked: nothing to remove */ }
  // The removed list is the one thing a wipe keeps; it holds file names and digests, no reading data.
  for (const r of keep) rememberRemoval({ note: MAC_NOTE + (r.sha256 ?? ''), sourceName: r.name });
}

async function wipe(ctx: AppContext): Promise<void> {
  await eraseAllData(ctx);
  location.hash = '#/';
  location.reload();
}

export function dataGroup(ctx: AppContext): HTMLElement {
  const { store } = ctx;
  const status = h('div.set-test-out', { role: 'status', 'aria-live': 'polite' });
  const say = (msg: string, bad = false) => { status.className = 'set-test-out' + (bad ? ' set-bad' : ' set-good'); status.textContent = msg; };

  const exportBtn = h('button.btn.btn-sm', { type: 'button' }, icon('download'), 'Export backup') as HTMLButtonElement;
  exportBtn.addEventListener('click', async () => {
    try {
      const json = await store.exportBackup();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = h('a', { href: url, download: backupFileName() });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      say('Backup saved to your downloads.');
    } catch (e) {
      say(e instanceof Error ? e.message : 'Could not create the backup.', true);
    }
  });

  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-hidden': 'true', tabindex: -1 }) as HTMLInputElement;
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const json = await f.text();
      const report = await store.importBackup(json);
      if (report.settings) ctx.settings.set(report.settings);
      say(describeReport(report));
    } catch (e) {
      say(e instanceof Error ? e.message : 'That file is not a Dushu backup.', true);
    }
  });
  const importBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => file.click() }, icon('upload'), 'Import backup');

  const delBtn = h('button.btn.btn-sm.btn-danger', { type: 'button' }, icon('trash'), 'Delete all data');
  delBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete all data?',
      message: 'This removes every book, saved word, known word, review record, reading position and setting (including the address of your Mac) from this browser. It cannot be undone. Books from your Mac are not added again; Restore in the Library brings them back. Export a backup first if you want to keep your words.',
      confirmLabel: 'Delete everything',
      danger: true,
    });
    if (!ok) return;
    try { await wipe(ctx); } catch (e) { say(e instanceof Error ? e.message : 'Could not delete the data.', true); }
  });

  const memoryWarning = store.backend === 'memory'
    ? h('div.set-warn', { role: 'alert' }, 'This browser is blocking local storage, so your books and words will be lost when you close the tab.')
    : null;

  return group('Data', 'Everything lives in this browser. Nothing is uploaded.',
    memoryWarning,
    row('Backup', 'Saved words, known words, reading progress, review history and settings. Books and the address of your Mac are excluded. On another device, import the same book files first, then import a fresh backup so progress and edited terms match their books.',
      h('div.set-backup', null, h('div.set-btn-row', null, exportBtn, importBtn, file), status)),
    row('Delete all data', 'Removes books, words and settings from this browser. Books from your Mac stay deleted until you restore them.', delBtn));
}
