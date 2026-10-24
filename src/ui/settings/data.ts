// The Data group: backup export/import and "delete all data".
import type { AppContext, BackupReport } from '../../types';
import { h } from '../dom';
import { icon } from '../icons';
import { confirmDialog } from '../library/dialogs';
import { currentSyncer, setSyncEnabled } from '../../core/sync';
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

/**
 * Removes books, words, progress, review history and every dushu.* key in localStorage. The Mac's books come back the next
 * time the library reaches the Mac: they are always there.
 */
export async function eraseAllData(ctx: AppContext): Promise<void> {
  // A sync that is running could bring words back in the middle of the wipe.
  currentSyncer()?.stop();
  await ctx.store.wipe();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('dushu.')) localStorage.removeItem(k);
  } catch { /* storage blocked: nothing to remove */ }
  // An empty device stays empty: the words on the Mac come back only when sync is turned on again.
  setSyncEnabled(false);
}

async function wipe(ctx: AppContext): Promise<void> {
  await eraseAllData(ctx);
  // replaceState fires no hashchange: setting the hash would mount the Library (and start a Mac download) just before the reload.
  history.replaceState(null, '', location.pathname + location.search + '#/');
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
      message: 'This removes every book, saved word, known word, review record, reading position and setting (including the address of your Mac) from this browser. It cannot be undone. Books from your Mac are added again the next time this device reaches your Mac. Sync is turned off here, so the copy of your words on your Mac stays there and does not come back until you turn sync on again.',
      confirmLabel: 'Delete everything',
      danger: true,
    });
    if (!ok) return;
    try { await wipe(ctx); } catch (e) { say(e instanceof Error ? e.message : 'Could not delete the data.', true); }
  });

  const memoryWarning = store.backend === 'memory'
    ? h('div.set-warn', { role: 'alert' }, 'This browser is blocking local storage, so your books and words will be lost when you close the tab.')
    : null;

  return group('Data', 'Everything lives in this browser. When it is connected to your Mac, your words and reading places are also kept on the Mac, never anywhere else.',
    memoryWarning,
    row('Backup', 'Saved words, known words, reading progress, review history and settings. Books and the address of your Mac are excluded. On another device, import the same book files first, then import a fresh backup so progress and edited terms match their books.',
      h('div.set-backup', null, h('div.set-btn-row', null, exportBtn, importBtn, file), status)),
    row('Delete all data', 'Removes books, words and settings from this browser. Books from your Mac come back when it reaches your Mac.', delBtn));
}
