// The Data group: backup export/import and "delete all data".
import type { AppContext, BackupReport } from '../../types';
import { h } from '../dom';
import { icon } from '../icons';
import { confirmDialog } from '../library/dialogs';
import { currentSyncer, setSyncEnabled } from '../../core/sync';
import { group, row } from './controls';
import { isChinese, lang, langId } from '../../lang/active';
import { LANG_IDS } from '../../lang/registry';


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
 * time the library reaches the Mac: they are always there. Another language removes only its own library and its own
 * dushu.<id>.* keys: Chinese, the sign-in, the Mac link and sync are not its to touch (lang/active.ts).
 */
export async function eraseAllData(ctx: AppContext): Promise<void> {
  if (!isChinese()) {
    await ctx.store.wipe();
    const own = `dushu.${langId()}.`;
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(own)) localStorage.removeItem(k);
    } catch { /* storage blocked: nothing to remove */ }
    return;
  }
  // A sync that is running could bring words back in the middle of the wipe.
  currentSyncer()?.stop();
  await ctx.store.wipe();
  // The other languages' libraries are left alone, and so are their settings.
  const others = LANG_IDS.filter((id) => id !== 'zh').map((id) => `dushu.${id}.`);
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('dushu.') && !others.some((o) => k.startsWith(o))) localStorage.removeItem(k);
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
      message: isChinese()
        ? 'This removes every book, word, review record, reading place and setting from this browser, and it can’t be undone. Books from your Mac come back the next time this device reaches it. Sync is turned off here, so the words kept on your Mac stay there until you turn sync back on.'
        : `This removes every book, word, review record, reading place and setting of your ${lang().name} library from this browser, and it can’t be undone. Your other languages stay as they are.`,
      confirmLabel: 'Delete everything',
      danger: true,
    });
    if (!ok) return;
    try { await wipe(ctx); } catch (e) { say(e instanceof Error ? e.message : 'Could not delete the data.', true); }
  });

  const memoryWarning = store.backend === 'memory'
    ? h('div.set-warn', { role: 'alert' }, 'This browser is blocking local storage, so your books and words will be lost when you close the tab.')
    : null;

  return group('Data', null,
    memoryWarning,
    row('Backup', 'Your words, known words, progress, review history and settings. Books are not included, so on another device import the same book files first.',
      h('div.set-backup', null, h('div.set-btn-row', null, exportBtn, importBtn, file), status)),
    row('Delete all data', isChinese() ? 'Removes books, words and settings from this browser.' : `Removes your ${lang().name} books, words and settings from this browser.`, delBtn));
}
