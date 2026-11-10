// The Data group: backup export/import and "delete all data".
import type { AppContext, BackupReport } from '../../types';
import { h } from '../dom';
import { icon } from '../icons';
import { confirmDialog } from '../library/dialogs';
import { currentSyncer, setSyncEnabled, withoutSync } from '../../core/sync';
import { group, row } from './controls';
import { isChinese, lang, langId, LANG_KEY } from '../../lang/active';
import { LANG_IDS } from '../../lang/registry';
import { LOCAL_ONLY_KEY, TARGET_KEY } from '../../store/settings';
import { ACTIVITY_KEY, dayOf } from '../../core/activity';
import { getPlan, PLAN_KEY } from '../../core/plan';
import { OWNER_KEY, SESSION_KEY, URL_KEY } from '../../core/cloud';
import { DECLINED_KEY, STORE_KEY as MAC_BRIDGE_KEY } from '../../core/macBridge';

/**
 * The backup's file name: the app, the language (a Spanish and a German backup of one day are two files) and the local day,
 * globereader-spanish-backup-2026-11-09.json. The file itself still says app: 'dushu', which every backup has (importBackup).
 */
export function backupFileName(d = new Date()): string {
  return `globereader-${lang().name.toLowerCase()}-backup-${dayOf(d.getTime())}.json`;
}

/**
 * The keys no single library owns: the reader's language choices and Local only, the reading time and streak, the plan (the
 * languages learned and the goal), the languages used and the last one open, the sign-in and the Mac link. A Chinese "Delete
 * all data" keeps them while another library is on the device, since that library reads them too.
 */
// ui/langSwitch.ts USED_KEY and core/passkey.ts PASSKEY_HERE, which those modules keep to themselves.
const USED_KEY = 'dushu.langs-used.v1';
const PASSKEY_HERE = 'dushu.passkey-here.v1';
export const SHARED_DEVICE_KEYS: readonly string[] = [
  TARGET_KEY, LOCAL_ONLY_KEY, ACTIVITY_KEY, PLAN_KEY, LANG_KEY, USED_KEY,
  SESSION_KEY, OWNER_KEY, URL_KEY, PASSKEY_HERE,
  MAC_BRIDGE_KEY, DECLINED_KEY,
];

/** What the other languages' own keys start with (dushu.ja., dushu.es., …). */
const OTHER_PREFIXES = LANG_IDS.filter((id) => id !== 'zh').map((id) => `dushu.${id}.`);
const otherLibraryKey = (k: string) => OTHER_PREFIXES.some((o) => k.startsWith(o));

/** Whether this device has a library besides Chinese: its keys, a language used, a plan or reading time in another language. */
function otherLibraryHere(keys: string[]): boolean {
  if (keys.some((k) => otherLibraryKey(k) || k === USED_KEY)) return true;
  if (getPlan().langs.some((l) => l !== 'zh')) return true;
  try {
    const act = JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? 'null') as { days?: Record<string, Record<string, { s?: Record<string, unknown> }>> } | null;
    return Object.values(act?.days ?? {}).some((devices) => Object.values(devices ?? {}).some((d) =>
      Object.entries(d?.s ?? {}).some(([l, n]) => l !== 'zh' && typeof n === 'number' && n > 0)));
  } catch { return false; }
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
  if (r.bookmarks.added) parts.push(`added ${n(r.bookmarks.added, 'bookmark')}`);
  if (r.lookups.added) parts.push(`added ${n(r.lookups.added, 'looked-up word')}`);
  if (r.settings) parts.push('restored your settings');
  if (!parts.length) return 'Nothing new in that backup. Everything in it was already here.';
  const text = parts.join(', ');
  return text[0].toUpperCase() + text.slice(1) + '.';
}

/**
 * Removes books, words, progress, review history and every dushu.* key in localStorage but the other languages' (dushu.<id>.*)
 * and, while another library is here, the keys they share (SHARED_DEVICE_KEYS: the streak, the plan, the sign-in, the Mac
 * link). A reader with Chinese alone loses those too. The Mac's books come back the next time the library reaches the Mac:
 * they are always there. Another language removes only its own library and its own dushu.<id>.* keys: Chinese, the sign-in
 * and the Mac link are not its to touch (lang/active.ts). Either way the library's sync is turned off, so what the account or
 * the Mac keeps of it does not come straight back.
 */
export async function eraseAllData(ctx: AppContext): Promise<void> {
  // A sync under way could bring words back after the wipe: one waiting on the hub's answer when Delete everything is pressed
  // would write it into the empty library. This page's syncer is stopped and waited for (it applies nothing once stopped), and
  // the wipe holds the sync lock, so a sync in another tab ends first and finds its switch off after.
  await currentSyncer()?.stop();
  await withoutSync(() => erase(ctx));
}

async function erase(ctx: AppContext): Promise<void> {
  if (!isChinese()) {
    await ctx.store.wipe();
    const own = `dushu.${langId()}.`;
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(own)) localStorage.removeItem(k);
    } catch { /* storage blocked: nothing to remove */ }
    // An empty library stays empty: its words and books in the account (or on the Mac) come back only when its sync is turned
    // on again. Its own switch (dushu.<id>.sync.off.v1, written after the keys above went): the Chinese library syncs on.
    setSyncEnabled(false);
    return;
  }
  await ctx.store.wipe();
  // The other languages' libraries are left alone, and so is what they share with Chinese (SHARED_DEVICE_KEYS): the language
  // translated into (taking it would put the Spanish library back on English), the streak and the reading time of every
  // language, the plan, the sign-in and the Mac link. A reader who never opened another language has no other library to keep
  // them for: theirs go with everything else.
  try {
    const keys = Object.keys(localStorage);
    const kept = otherLibraryHere(keys) ? new Set(SHARED_DEVICE_KEYS) : new Set<string>();
    for (const k of keys) {
      if (k.startsWith('dushu.') && !kept.has(k) && !otherLibraryKey(k)) localStorage.removeItem(k);
    }
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
      say(e instanceof Error ? e.message : 'That file is not a Globereader backup.', true);
    }
  });
  const importBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => file.click() }, icon('upload'), 'Import backup');

  const delBtn = h('button.btn.btn-sm.btn-danger', { type: 'button' }, icon('trash'), 'Delete all data');
  const otherLibrary = () => { try { return otherLibraryHere(Object.keys(localStorage)); } catch { return false; } };
  delBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete all data?',
      message: isChinese() && otherLibrary()
        ? 'This removes every Chinese book, word, review record, reading place and setting from this browser, and it can’t be undone. Your other languages, your streak and your sign-in stay as they are. Books from your Mac come back the next time this device reaches it. Sync is turned off for Chinese here, so what your account or your Mac keeps of it stays there until you turn its sync back on.'
        : isChinese()
        ? 'This removes every book, word, review record, reading place and setting from this browser, and it can’t be undone. Books from your Mac come back the next time this device reaches it. Sync is turned off here, so the words kept on your Mac stay there until you turn sync back on.'
        : `This removes every book, word, review record, reading place and setting of your ${lang().name} library from this browser, and it can’t be undone. Your other languages stay as they are. Sync is turned off for ${lang().name} here, so what your account or your Mac keeps of it stays there until you turn its sync back on.`,
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
    row('Backup', 'Your words, known words, progress, bookmarks, looked-up words, review history and settings. Books are not included, so on another device import the same book files first.',
      h('div.set-backup', null, h('div.set-btn-row', null, exportBtn, importBtn, file), status)),
    row('Delete all data', isChinese() ? 'Removes books, words and settings from this browser.' : `Removes your ${lang().name} books, words and settings from this browser.`, delBtn));
}
